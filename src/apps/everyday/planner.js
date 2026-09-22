'use strict';
const crypto=require('crypto');
const {devices}=require('../../devices');
const {evaluateStep,planDecision}=require('../../orchestrator');
const {interpretWithAI}=require('../../ai-intent');
const {snapshot}=require('./store');
const {runtimeStatus}=require('../../runtime');
const ROOMS={living_room:'거실',bedroom:'침실',room:'개인 방',entrance:'현관'};
const ROUTINES=[
  {id:'study',name:'집중 시작',text:'공부 시작할게',description:'내 밝기와 공부 도구 준비',re:/^(?:나\s*)?(?:이제\s*)?(?:공부|집중)(?:\s*모드)?\s*(?:시작(?:할게|해줘|해|하기)?|할게|준비(?:해줘)?)$/},
  {id:'resume',name:'이어서 하기',text:'여기서 이어서 할게',description:'하던 활동을 지금 공간에서',re:/^(?:여기(?:서)?\s*)?(?:(?:하던\s*)?(?:공부|활동)(?:를)?\s*)?(?:이어서|계속)\s*(?:할게|해줘|하기|해|진행)?$/},
  {id:'relax',name:'잠깐 쉬기',text:'잠깐 쉴게',description:'활동을 멈추고 편안한 밝기로',re:/^(?:(?:나|이제|잠깐)\s*){0,2}(?:쉴게|쉬자|쉬고\s*싶어|휴식(?:\s*모드)?|쉬기)$/},
  {id:'arrive',name:'집에 도착',text:'집에 왔어',description:'지금 공간에 불 켜기',re:/^(?:(?:나|이제)\s*)?(?:집에\s*(?:왔어|도착(?:했어)?)|다녀왔어)$/},
  {id:'bedtime',name:'하루 마무리',text:'나 잘게',description:'조명과 개인 기기 정리',re:/^(?:(?:나|이제)\s*){0,2}(?:잘게|자러\s*갈게|취침(?:\s*모드)?|잘\s*거야)$/},
  {id:'leave',name:'외출 준비',text:'나 이제 나갈게',description:'빈 공간 정리와 노트북 잠금',re:/^(?:(?:나|이제)\s*){0,2}(?:나갈게|외출(?:할게|\s*준비)?|집에서\s*나갈게)$/},
];
function lightAt(location) {return location==='living_room'?'living_room_light':['bedroom','room'].includes(location)?'bedroom_light':null;}
function step(id,device,capability,args,title,extra={}) {return {id,device,capability,args,title,optional:true,failure_policy:'continue',...extra};}
function executionMode(device) {
  if (device?.adapter_id==='home_assistant_light') return 'live';
  if (device?.type==='windows_pc'&&runtimeStatus().pc_live) return 'live';
  return 'simulation';
}
function decorate(plan) {
  for (const item of plan.steps) { item.execution_mode=executionMode(devices[item.device]);item.device_name=devices[item.device]?.name||item.device; }
  return plan;
}
async function buildEverydayPlan(text,{identity,context}) {
  if (typeof text!=='string'||!text.trim()||text.length>500) return {ok:false,reason:'1~500자 명령을 입력해 주세요.'};
  const raw=text.trim(),normalized=raw.replace(/[.!。]$/,'').trim();
  if (/지\s*마|하지\s*말|안\s*(?:켜|꺼|해)|말아|않(?:아|고|게)|취소/.test(raw)) return {ok:false,reason:'취소·부정 표현이 있어 실행 계획을 만들지 않았어요. 실행하려는 동작만 새로 말해 주세요.'};
  const template=ROUTINES.find(x=>x.re.test(normalized));
  if (template && identity.role!=='owner') return {ok:false,reason:'개인 활동 루틴은 소유자 역할에서 사용할 수 있어요. 다른 역할은 권한이 있는 개별 기기를 요청해 주세요.'};
  const data=snapshot(),p=data.profile,s=data.session,location=context.current_location;
  let specs=[],effect=null,title='',explanation='',engine='local-rules',warning=null;
  const add=(...args)=>specs.push(step(...args));
  const light=lightAt(location);
  if (template) {
    title=template.name;
    if (['study','resume','relax','arrive'].includes(template.id)&&!light) return {ok:false,reason:'먼저 위쪽에서 거실이나 침실을 선택해 주세요. 현재 위치를 추측해서 실행하지 않아요.'};
    if (template.id==='resume'&&(!s||s.status==='completed')) return {ok:false,reason:'이어갈 활동이 없어요. 먼저 집중을 시작해 주세요.'};
    if (['study','resume'].includes(template.id)) {
      if (template.id==='resume'&&lightAt(s.location)&&lightAt(s.location)!==light) add('previous_light',lightAt(s.location),'turn_off',{},'이전 공간의 조명 정리',{skip_if_other_occupants:true});
      add('focus_light',light,'set_brightness',{brightness:p.study_brightness},`${ROOMS[location]} 조명 ${p.study_brightness}%`,{skip_if_other_occupants:true});
      if (template.id==='study'&&p.open_notepad) add('notes','my_laptop','open_app',{app:'notepad'},'노트북 메모장 열기');
      const activity=template.id==='resume'?s.title:p.focus_title;
      add('focus_display','room_display','display_message',{message:`${activity} · ${template.id==='resume'?'이어서 진행':p.focus_minutes+'분 집중'}`},'안내 화면에 활동 표시');
      effect=template.id==='resume'?'resume':'start';
      explanation=template.id==='resume'?`“${s.title}”의 남은 ${Math.ceil(s.remaining_ms/60000)}분을 유지하고 ${ROOMS[location]}에 내 설정을 적용해요.`:`${p.focus_title}, ${p.focus_minutes}분. ${ROOMS[location]}을 저장한 공부 밝기로 준비해요.`;
    } else if (template.id==='relax') {
      add('relax_light',light,'set_brightness',{brightness:p.relax_brightness},`${ROOMS[location]} 조명 ${p.relax_brightness}%`,{skip_if_other_occupants:true});
      add('pause_display','room_display','display_message',{message:'잠깐 쉬는 중 · 하던 활동은 저장되어 있어요'},'안내 화면에 쉬는 중 표시');
      effect='pause';explanation='진행 중인 집중 시간은 멈추고, 다음에 이어갈 수 있게 저장해요.';
    } else if (template.id==='arrive') {
      add('arrival_light',light,'turn_on',{},`${ROOMS[location]} 조명 켜기`);
      add('arrival_display','room_display','display_message',{message:s&&s.status!=='completed'?`이어갈 활동: ${s.title}`:'반가워요. 오늘 할 일을 시작해 볼까요?'},'안내 화면 준비');
      explanation='지금 공간을 준비하고 이어갈 활동이 있는지 알려줘요.';
    } else if (template.id==='leave') {
      for (const id of ['living_room_light','bedroom_light']) add('off_'+id,id,'turn_off',{},`${devices[id].name} 끄기`,{skip_if_other_occupants:true});
      add('display_off','room_display','turn_off',{},'안내 화면 끄기',{skip_if_other_occupants:true});
      add('lock_pc','my_laptop','power_action',{power_action:'lock'},'노트북 잠금');
      effect='pause';explanation='다른 사람이 쓰는 공간은 유지하고 빈 공간과 내 노트북을 정리해요.';
    } else if (template.id==='bedtime') {
      add('living_off','living_room_light','turn_off',{},'거실 조명 끄기',{skip_if_other_occupants:true});
      add('bedroom_dim','bedroom_light','set_brightness',{brightness:p.sleep_brightness},`침실 조명 ${p.sleep_brightness}%`,{skip_if_other_occupants:true});
      add('display_off','room_display','turn_off',{},'안내 화면 끄기',{skip_if_other_occupants:true});
      add('lock_pc','my_laptop','power_action',{power_action:'lock'},'노트북 잠금');
      effect='pause';explanation='하던 활동을 저장하고 조명과 개인 기기를 정리해요.';
    }
  } else {
    if (/그리고|동시에|끄고|켜고|켜고|하고.*(?:켜|꺼|열)|[?？]/.test(raw)) return {ok:false,reason:'여러 요청이나 질문은 나눠서 입력해 주세요. 일상 버튼은 여러 기기를 함께 준비할 수 있어요.'};
    const result=await interpretWithAI(raw,{context});
    if (!result.ok) return {ok:false,reason:result.reason||'지원하는 행동을 찾지 못했어요.',needs_clarification:result.needs_clarification===true,question:result.question,options:result.options||[],suggestion:result.suggestion||'아래 일상 버튼을 사용하거나 “거실 조명 40%로”처럼 말해 주세요.'};
    // v1.4 daily surface intentionally excludes entry/door control; legacy simulator retains it.
    if (result.action.device==='front_door') return {ok:false,reason:'일상 화면에서는 조명·안내 화면·노트북을 지원해요.'};
    add('single',result.action.device,result.action.capability,result.action.args,result.explanation||'기기 동작',{optional:false,failure_policy:'stop'});
    title='기기 요청';explanation=result.explanation;engine=result.engine;warning=result.warning;
  }
  const steps=specs.map(item=>evaluateStep(item,{identity,context,sourceText:raw}));
  const decision=planDecision(steps);
  return decorate({ok:decision.level!=='blocked',plan_id:crypto.randomUUID(),orchestrator_version:'reality-everyday/1.4.3',everyday:true,intent:template?.id||'single',title,source_text:raw,explanation,engine,warning,created_at:Date.now(),expires_at:Date.now()+300000,identity_snapshot:{id:identity.id,role:identity.role},context_snapshot:{current_location:location},store_revision:data.revision,session_effect:effect,decision:decision.level,reason:decision.reason,steps,summary:{total:steps.length,executable:steps.filter(x=>x.status==='planned').length,skipped:steps.filter(x=>x.status==='skipped').length,blocked:steps.filter(x=>x.status==='blocked').length}});
}
module.exports={buildEverydayPlan,ROUTINES,lightAt,executionMode};
