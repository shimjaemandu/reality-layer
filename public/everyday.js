'use strict';
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const roomName={living_room:'거실',bedroom:'침실',room:'개인 방',entrance:'현관'};
const actionName={turn_on:'켜기',turn_off:'끄기',set_brightness:'밝기 조절',display_message:'메시지 표시',open_app:'앱 열기',power_action:'노트북 잠금'};
const routineIcons={study:'⌑',resume:'↗',relax:'◡',arrive:'⌂',bedtime:'☾',leave:'⇥'};
let token='',state=null,plan=null,working=false,executing=false,sessionReceivedAt=0,toastTimeout,recognition=null;
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(url,body) {
  const res=await fetch(url,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Reality-Token':token},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const result=await res.json();
  if (!res.ok) {const error=new Error(result.error||result.reason||'요청을 처리하지 못했어요.');error.data=result;throw error;}
  return result;
}
function toast(message) {$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimeout);toastTimeout=setTimeout(()=>$('#toast').hidden=true,4200);}
function tab(id) {
  $$('.tab-panel').forEach(el=>el.hidden=el.id!==id);
  $$('.nav-item').forEach(el=>{el.classList.toggle('selected',el.dataset.tab===id);el.setAttribute('aria-current',el.dataset.tab===id?'page':'false');});
  $('#pageLabel').textContent={home:'나의 일상 / Everyday',preferences:'내 설정 / Context',connections:'연결 / Devices',history:'기록 / History'}[id];
  if(id==='history')api('/api/logs').then(data=>renderHistory(data.logs)).catch(e=>toast(e.message));
  if(id==='connections')refreshPcRegistry().catch(e=>toast(e.message));
}
function fillProfile(profile) {
  const form=$('#profileForm');
  for(const [key,value] of Object.entries(profile)){const field=form.elements[key];if(!field)continue;if(field.type==='checkbox')field.checked=value;else field.value=value;}
}
function renderDevices() {
  for(const [id,prefix,elId] of [['living_room_light','living','livingRoom'],['bedroom_light','bedroom','bedroom']]){
    const device=state.devices.find(d=>d.id===id),s=device.state,unavailable=s.availability==='unavailable';
    $(`#${elId}`).classList.toggle('on',s.power==='on'&&!unavailable);
    $(`#${elId}`).classList.toggle('current',state.context.current_location===(id==='living_room_light'?'living_room':'bedroom'));
    $(`#${prefix}Power`).textContent=unavailable?'연결 확인 필요':s.power==='on'?`켜짐${s.brightness===null?'':` · ${s.brightness}%`}`:s.power==='off'?'꺼짐':'상태 미확인';
    $(`#${prefix}Mode`).textContent=device.execution_mode==='live'?'실제 조명':`가상 조명 ${prefix==='living'?'A':'B'}`;
    const room=id==='living_room_light'?'living_room':'bedroom';
    const here=state.context.current_location===room;
    const family=state.actor_presence?.family?.present&&state.actor_presence.family.location===room;
    $(`#${prefix}Presence`).textContent=[here?'내가 있는 곳':'',family?'가족 사용 중':''].filter(Boolean).join(' · ');
  }
  const pc=state.devices.find(d=>d.id==='my_laptop'),display=state.devices.find(d=>d.id==='room_display');
  $('#deviceStrip').innerHTML=`<span>▱ 노트북 · ${pc.execution_mode==='live'?'실제 연결':'가상 체험'}${pc.state.last_target_name?' · '+esc(pc.state.last_target_name):''}</span><span>▭ 안내 화면 · ${display.state.power==='on'?esc(display.state.message):'꺼짐'}</span>`;
  $('#familyPresent').checked=state.actor_presence?.family?.present===true&&state.actor_presence.family.location==='living_room';
  $('#connectionList').innerHTML=state.devices.map(d=>`<article class="connection-card"><span class="connection-icon">${d.type==='light'?'☼':d.type==='windows_pc'?'▱':'▭'}</span><div><h3>${esc(d.name)}</h3><p>${esc(d.vendor)} · ${esc(roomName[d.location]||d.location)}</p></div><span class="mode-chip ${d.execution_mode==='live'?'real':''}">${d.execution_mode==='live'?'실제 연결':'가상 체험'}</span></article>`).join('');
}
function renderSession() {
  const s=state.session;
  $('#sessionTitle').textContent=s?s.title:'작은 시작, 하나부터.';
  $('#sessionDescription').textContent=s?`${roomName[s.location]||'이 공간'}에서 시작한 활동을 다른 공간에서도 이어가세요.`:'공부를 시작하면 공간을 옮겨도 남은 시간과 설정이 이어져요.';
  $('#resumeButton').disabled=!s||s.status==='completed';
  $('#pauseButton').hidden=!s||s.status!=='active';
  $('#sessionFootnote').textContent=s&&s.handoffs.length?`${s.handoffs.length}번 공간을 옮겨도 활동은 그대로.`:'활동은 이 노트북에 저장돼요.';
  updateClock();
}
function updateClock() {
  if(!state)return;
  const s=state.session;
  const remaining=s?Math.max(0,s.remaining_ms-(s.status==='active'?Date.now()-sessionReceivedAt:0)):state.profile.focus_minutes*60000;
  const seconds=Math.ceil(remaining/1000);
  $('#sessionClock').textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  $('#sessionProgress').style.width=(s?Math.min(100,100*(1-remaining/s.duration_ms)):0)+'%';
  $('#sessionStatus').textContent=!s?'대기':remaining===0?'완료':s.status==='active'?'집중 중':'잠시 멈춤';
  if(s&&remaining===0){$('#resumeButton').disabled=true;$('#pauseButton').hidden=true;}
}
function timeLabel(value){return new Date(value).toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'});}
function logMode(log){return log.state?.gateway_trace?.adapter_id==='home_assistant_light'||log.state?.gateway_trace?.native_trace?.dry_run===false?'실제':'가상';}
function logTitle(log){return `${log.device_name||log.device||'기기'} · ${actionName[log.capability]||log.capability||'동작'}`;}
function renderRecent(logs) {$('#recentLogs').innerHTML=logs.length?logs.slice(0,3).map(log=>`<div class="mini-log"><strong>${esc(logTitle(log))}</strong><span>${timeLabel(log.at)} · ${log.result==='error'?'오류':logMode(log)+' 동작 완료'}</span></div>`).join(''):'<div class="log-empty">아직 실행한 동작이 없어요.<br>하고 싶은 일부터 말해 주세요.</div>';}
function renderHistory(logs) {$('#historyList').innerHTML=logs.length?logs.map(log=>`<article class="history-entry"><time>${new Date(log.at).toLocaleDateString('ko-KR')}<br>${timeLabel(log.at)}</time><div><h3>${esc(logTitle(log))}</h3><p>${esc(log.error||log.source_text||'')}</p><details><summary>동작 상세</summary><pre>${esc(JSON.stringify({mode:logMode(log),action:log.unified_command,result:log.state?.gateway_trace?.native_trace||log.error},null,2))}</pre></details></div><span class="result-chip ${log.result==='error'?'error':''}">${log.result==='error'?'실패':logMode(log)+' 완료'}</span></article>`).join(''):'<div class="settings-card log-empty">아직 실행 기록이 없어요.</div>';}
async function refresh(initial=false) {
  const next=await api('/api/everyday');state=next;sessionReceivedAt=Date.now();
  $('#fatal').hidden=true;
  $('#modeLabel').textContent=state.runtime.live?'실제 연결 모드':'체험 모드';$('#modeLabel').classList.toggle('real',state.runtime.live);
  $('#engineLabel').textContent=state.ai.configured?'AI 해석 연결':'로컬 해석';
  $('#profileName').textContent=state.profile.name==='나'?'나의 공간':state.profile.name+'의 공간';$('#avatar').textContent=state.profile.name.slice(0,1);
  if(state.runtime.live)$('#demoNote').textContent='실제 연결 표시가 있는 기기는 실제로 동작해요. 가상 표시가 있는 기기는 화면에서만 바뀌어요.';
  $$('[data-location]').forEach(button=>{button.classList.toggle('active',button.dataset.location===state.context.current_location);button.setAttribute('aria-pressed',String(button.dataset.location===state.context.current_location));});
  if(initial){fillProfile(state.profile);$('#routines').innerHTML=state.routines.map(r=>`<button class="routine" data-routine="${esc(r.text)}" aria-label="${esc(r.name)}"><span class="routine-icon">${routineIcons[r.id]}</span><span class="arrow">↗</span><strong>${esc(r.name)}</strong><small>${esc(r.description)}</small></button>`).join('');}
  renderDevices();renderSession();renderRecent(state.logs);if($('#history').hidden)renderHistory(state.logs);
}
async function refreshPcRegistry(){
  const registry=await api('/api/pc-registry');
  const apps=registry.apps||[];
  const detected=apps.filter(a=>a.available);
  const vscode=apps.find(a=>a.id==='vscode');
  $('#appRegistrySummary').innerHTML=`<b>${detected.length}/${apps.length} 앱 자동 감지</b><br>${vscode?.available?'✓ VS Code 감지됨':'VS Code 경로 미확인 · 아래에서 Code.exe 경로를 등록할 수 있어요.'}`;
}
function showClarification(result){
  $('#clarifyQuestion').textContent=result.question||result.reason||'어떤 대상을 말한 건가요?';
  const options=Array.isArray(result.options)?result.options:[];
  $('#clarifyOptions').innerHTML=options.length?options.map((o,i)=>`<button type="button" class="secondary clarify-choice" data-clarify-index="${i}">${esc(o.label||o.text)}</button>`).join(''):`<p class="muted">${esc(result.suggestion||'대상을 직접 입력해 주세요.')}</p>`;
  $('#clarifyDialog').showModal();
  $$('[data-clarify-index]').forEach(button=>button.addEventListener('click',()=>{const option=options[Number(button.dataset.clarifyIndex)];$('#clarifyDialog').close();if(option?.text){$('#commandInput').value=option.text;$('#commandInput').focus();}}));
}
async function requestPlan(text) {
  if(working)return;working=true;$('#planButton').disabled=true;$('#planButton').textContent='준비 중…';
  try {
    const result=await api('/api/everyday/plan',{text});
    if(!result.ok){if(result.needs_clarification){showClarification(result);return;}throw new Error(result.reason||result.explanation||'실행할 수 있는 계획이 없어요.');}
    plan=result;$('#planTitle').textContent=result.title;$('#planDescription').textContent=result.explanation;
    $('#planMode').textContent=result.steps.some(s=>s.execution_mode==='live')?'실제 기기 동작이 포함돼 있어요. 아래 항목을 확인해 주세요.':'체험 계획 · 실제 기기를 움직이지 않고 화면에서 확인해요.';
    $('#planSteps').innerHTML=result.steps.map((s,i)=>`<article class="plan-step ${s.status==='skipped'?'skipped':''}" data-step="${esc(s.id)}"><span class="step-number">${i+1}</span><div><h3>${esc(s.title)}</h3><p>${esc(s.skip_reason||s.policy?.level==='blocked'&&s.policy.reason||s.device_name)}</p></div><span class="step-tag">${s.status==='skipped'?'생략':s.status==='blocked'?'차단':`${s.execution_mode==='live'?'실제':'가상'}${s.policy?.level==='confirm'?' · 확인 필요':''}`}</span></article>`).join('');
    $('#planOutcome').hidden=true;$('#planOutcome').classList.remove('error');$('#executePlan').hidden=false;$('#executePlan').disabled=false;
    $('#executePlan').textContent=result.decision==='confirm'?'확인하고 실행':'이대로 실행';$('#cancelPlan').textContent='취소';$('#cancelPlan').disabled=false;$('#closePlan').disabled=false;
    $('#planFootnote').textContent=result.intent==='study'&&state.session&&state.session.status!=='completed'?'새로 시작하면 기존 집중 시간을 새 시간으로 바꿔요. 이어가려면 취소 후 이어서 하기를 선택해 주세요.':'실행 직전에 공간과 권한을 다시 확인해요.';
    $('#planDialog').showModal();
  } catch(e){toast(e.message);}finally{working=false;$('#planButton').disabled=false;$('#planButton').innerHTML='준비해 줘 <span>↗</span>';}
}
async function closePlan() {
  if(executing)return;
  const id=plan?.plan_id;plan=null;$('#planDialog').close();
  if(id)try{await api('/api/everyday/cancel',{plan_id:id});}catch(e){toast(e.message);}
}
async function executePlan() {
  if(!plan||executing)return;executing=true;$('#executePlan').disabled=true;$('#executePlan').textContent='실행 중…';$('#cancelPlan').disabled=true;$('#closePlan').disabled=true;
  try {
    const result=await api('/api/everyday/execute',{plan_id:plan.plan_id,confirmed:true});
    for(const item of result.results){const el=$$('[data-step]').find(el=>el.dataset.step===item.step_id);if(!el)continue;el.querySelector('.step-tag').textContent={executed:'완료',skipped:'생략',blocked:'차단',error:'실패'}[item.status];if(item.reason)el.querySelector('p').textContent=item.reason;}
    $('#planOutcome').textContent=`${result.summary.executed}개 완료${result.summary.skipped?` · ${result.summary.skipped}개 생략`:''}${result.summary.failed?` · ${result.summary.failed}개 실패. 활동 변경은 저장하지 않았어요.`:'. 준비됐어요.'}`;
    $('#planOutcome').classList.toggle('error',Boolean(result.partial));$('#planOutcome').hidden=false;
    plan=null;await refresh();
  }catch(e){$('#planOutcome').textContent=e.message;$('#planOutcome').classList.add('error');$('#planOutcome').hidden=false;plan=null;await refresh().catch(()=>{});}
  finally{executing=false;$('#executePlan').hidden=true;$('#cancelPlan').disabled=false;$('#cancelPlan').textContent='닫기';$('#closePlan').disabled=false;}
}
document.addEventListener('click',event=>{
  const tabButton=event.target.closest('[data-tab]');if(tabButton)tab(tabButton.dataset.tab);
  const routine=event.target.closest('[data-routine]');if(routine){$('#commandInput').value=routine.dataset.routine;requestPlan(routine.dataset.routine);}
});
$$('[data-location]').forEach(button=>button.addEventListener('click',async()=>{
  if(working||executing)return;working=true;
  try{await api('/api/context',{current_location:button.dataset.location});await refresh();toast(state.session&&state.session.status!=='completed'?'공간을 바꿨어요. 이어서 하기를 눌러 활동을 가져오세요.':'현재 공간을 '+roomName[button.dataset.location]+'로 설정했어요.');}catch(e){toast(e.message);}finally{working=false;}
}));
$('#commandForm').addEventListener('submit',e=>{e.preventDefault();requestPlan($('#commandInput').value);});
$('#clarifyCancel').addEventListener('click',()=>{$('#clarifyDialog').close();$('#commandInput').focus();});
$('#appRegisterForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;$('#appRegisterStatus').textContent='등록 중…';const fd=new FormData(form);const body={id:String(fd.get('id')||'').trim().toLowerCase(),name:String(fd.get('name')||'').trim(),path:String(fd.get('path')||'').trim(),aliases:String(fd.get('aliases')||'').split(',').map(x=>x.trim()).filter(Boolean),process_name:''};try{await api('/api/apps/register',body);$('#appRegisterStatus').textContent='등록했어요. 다음 명령부터 사용할 수 있어요.';await refreshPcRegistry();toast('앱 경로를 등록했어요.');}catch(error){$('#appRegisterStatus').textContent=error.message;toast(error.message);}finally{button.disabled=false;}});
$('#discoverVscode').addEventListener('click',async()=>{const button=$('#discoverVscode');button.disabled=true;$('#appRegisterStatus').textContent='Windows에서 VS Code를 찾는 중…';try{const result=await api('/api/apps/discover',{id:'vscode'});const method=result.app?.discovered_by==='start_menu'?'Windows 시작 메뉴':result.app?.discovered_by==='where'?'PATH/where':result.app?.discovered_by==='known_path'?'설치 경로':'Windows';$('#appRegisterStatus').textContent=`VS Code를 찾았어요 (${method}). 이제 “VS Code 켜줘”를 바로 사용할 수 있어요.`;await refreshPcRegistry();toast('VS Code 자동 탐색 성공');}catch(error){$('#appRegisterStatus').textContent=error.message;toast(error.message);}finally{button.disabled=false;}});
$('#commandInput').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();requestPlan(e.target.value);}});
$('#executePlan').addEventListener('click',executePlan);$('#cancelPlan').addEventListener('click',closePlan);$('#closePlan').addEventListener('click',closePlan);
$('#planDialog').addEventListener('cancel',e=>{e.preventDefault();closePlan();});
$('#resumeButton').addEventListener('click',()=>requestPlan('여기서 이어서 할게'));
$('#pauseButton').addEventListener('click',async()=>{try{await api('/api/everyday/session',{action:'pause'});await refresh();toast('남은 시간을 저장하고 잠시 멈췄어요.');}catch(e){toast(e.message);}});
$('#profileForm').addEventListener('submit',async e=>{e.preventDefault();const form=e.currentTarget,button=form.querySelector('button[type="submit"]');button.disabled=true;const data={};for(const [key,value] of new FormData(form))data[key]=['name','focus_title','open_notepad'].includes(key)?value:Number(value);data.open_notepad=form.elements.open_notepad.checked;try{await api('/api/everyday/profile',data);await refresh();$('#saveStatus').textContent='저장했어요.';toast('다음 계획부터 새 설정을 적용해요.');}catch(e){toast(e.message);}finally{button.disabled=false;}});
$('#familyPresent').addEventListener('change',async e=>{const field=e.target;field.disabled=true;try{await api('/api/context-graph/actor',{actor_id:'family',present:field.checked,location:field.checked?'living_room':null});await refresh();}catch(error){field.checked=!field.checked;toast(error.message);}finally{field.disabled=false;}});
$('#refreshDevices').addEventListener('click',async()=>{const button=$('#refreshDevices');button.disabled=true;try{await api('/api/everyday/refresh',{});await refresh();toast('기기 상태를 확인했어요.');}catch(e){toast(e.message);}finally{button.disabled=false;}});
const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
$('#voiceButton').addEventListener('click',()=>{if(recognition){recognition.stop();return;}if(!SpeechRecognition){toast('이 브라우저는 음성 입력을 지원하지 않아요. 글자로 입력해 주세요.');return;}$('#voiceDialog').showModal();});
$('#voiceCancel').addEventListener('click',()=>$('#voiceDialog').close());
$('#voiceStart').addEventListener('click',()=>{
  $('#voiceDialog').close();if(!SpeechRecognition)return;
  recognition=new SpeechRecognition();recognition.lang='ko-KR';recognition.continuous=false;recognition.interimResults=false;
  recognition.onstart=()=>{$('#voiceButton').classList.add('listening');$('#voiceButton').querySelector('span').textContent='듣는 중 · 눌러서 중지';$('#inputHint').textContent='짧게 말해 주세요. 인식한 문장은 직접 확인할 수 있어요.';};
  recognition.onresult=e=>{$('#commandInput').value=e.results[0][0].transcript;$('#commandInput').focus();toast('인식한 문장을 확인하고 준비해 줘를 눌러 주세요.');};
  recognition.onerror=e=>toast(e.error==='not-allowed'?'마이크 권한이 없어요. 브라우저 권한을 확인하거나 글자로 입력해 주세요.':'음성을 인식하지 못했어요. 다시 말하거나 글자로 입력해 주세요.');
  recognition.onend=()=>{recognition=null;$('#voiceButton').classList.remove('listening');$('#voiceButton').querySelector('span').textContent='음성 입력';$('#inputHint').textContent='먼저 실행할 내용을 보여드려요. 확인 후 기기를 움직여요.';};
  try{recognition.start();}catch{recognition=null;toast('마이크를 시작하지 못했어요. 글자로 입력해 주세요.');}
});
async function boot(){try{token=(await api('/api/session')).token;await refresh(true);}catch(e){$('#fatal').textContent='서버와 연결하지 못했어요. START-DEMO.cmd 또는 npm start로 실행한 뒤 이 주소를 다시 열어 주세요. '+e.message;$('#fatal').hidden=false;}}
$('#today').textContent=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'short'});
setInterval(updateClock,1000);
setInterval(()=>{if(state&&!working&&!executing&&!$('#planDialog').open&&document.visibilityState==='visible')refresh().catch(()=>{$('#fatal').textContent='서버 연결이 끊겼어요. 실행 창을 확인한 뒤 화면을 새로고침해 주세요.';$('#fatal').hidden=false;});},10000);
boot();
