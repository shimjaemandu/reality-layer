'use strict';
process.env.REALITY_LIVE='0';process.env.PC_ADAPTER_DRY_RUN='1';
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {server}=require('../server');
const ha=require('../src/adapters/home-assistant-light');
const {devices}=require('../src/devices');
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  const token=(await (await fetch(base+'/api/session')).json()).token;
  async function request(route,body,headers={}){const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Reality-Token':token,...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,...await r.json()};}
  const plan=text=>request('/api/everyday/plan',{text});
  const run=id=>request('/api/everyday/execute',{plan_id:id,confirmed:true});
  const move=location=>request('/api/context',{current_location:location});
  try{
    await request('/api/reset',{});await move('living_room');
    await test('session token, origin, host 검증이 기기 API를 보호한다',async()=>{
      assert.equal((await request('/api/context',{current_location:'bedroom'},{'X-Reality-Token':''})).status,403);
      assert.equal((await request('/api/context',{current_location:'bedroom'},{Origin:'https://untrusted.example'})).status,403);
      const hostStatus=await new Promise((resolve,reject)=>require('node:http').get(base+'/api/everyday',{headers:{Host:'untrusted.example'}},r=>{r.resume();resolve(r.statusCode);}).on('error',reject));
      assert.equal(hostStatus,403);
      assert.equal((await request('/api/everyday')).runtime.live,false);
    });
    await test('v1.7은 Everyday를 앱 계층으로 유지하고 Identity를 데모로 명시한다',async()=>{
      const state=await request('/api/everyday');
      assert.equal(state.version,'1.8.2.1');
      assert.equal(state.identity.authenticated,false);
      assert.equal(state.identity.identity_assurance,'demo');
      assert.equal(state.identity.real_world_verified,false);
      const planner=require('../src/apps/everyday/planner');
      const compat=require('../src/everyday-planner');
      assert.equal(planner.buildEverydayPlan,compat.buildEverydayPlan);
    });
    await test('내 설정 검증·저장·새 프로세스 복원',async()=>{
      assert.equal((await request('/api/everyday/profile',{study_brightness:130})).status,400);
      const saved=await request('/api/everyday/profile',{name:'테스트',study_brightness:72,focus_minutes:35,focus_title:'원운동 탐구'});
      assert.equal(saved.profile.study_brightness,72);
      const fresh=JSON.parse(execFileSync(process.execPath,['-e',"process.stdout.write(JSON.stringify(require('./src/everyday-store').snapshot()))"],{cwd:require('node:path').join(__dirname,'..'),encoding:'utf8'}));
      assert.equal(fresh.profile.focus_title,'원운동 탐구');
    });
    await test('계획만 만들거나 취소하면 기기가 움직이지 않는다',async()=>{
      const before=devices.living_room_light.state.power;
      const p=await plan('공부 시작할게');assert.equal(p.ok,true);
      assert.equal(devices.living_room_light.state.power,before);
      await request('/api/everyday/cancel',{plan_id:p.plan_id});
      assert.equal((await run(p.plan_id)).status,400);
      assert.equal(devices.living_room_light.state.power,before);
    });
    await test('공부 시작 → 메모장 모의 실행 → 활동 시간 저장',async()=>{
      const p=await plan('공부 시작할게'),result=await run(p.plan_id);
      assert.equal(result.status,'completed');assert.equal(result.summary.executed,3);
      assert.equal(devices.living_room_light.state.brightness,72);
      assert.equal(result.results.find(x=>x.device==='my_laptop').state.gateway_trace.native_trace.dry_run,true);
      assert.equal(result.everyday.session.title,'원운동 탐구');
      assert.equal(result.everyday.session.duration_ms,35*60000);
      assert.equal((await run(p.plan_id)).status,400);
    });
    await test('일시정지 → 공간 이동 → 이어가기는 활동과 남은 시간을 유지한다',async()=>{
      const paused=await request('/api/everyday/session',{action:'pause'}),before=paused.session;
      assert.equal(before.status,'paused');await move('bedroom');
      const p=await plan('여기서 이어서 할게');assert.equal(p.ok,true);
      const result=await run(p.plan_id),after=result.everyday.session;
      assert.equal(after.id,before.id);assert.equal(after.title,before.title);
      assert.ok(after.remaining_ms<=before.remaining_ms);assert.ok(after.remaining_ms>before.remaining_ms-1000);
      assert.equal(after.location,'bedroom');assert.equal(after.handoffs.length,1);
      assert.equal(devices.bedroom_light.state.brightness,72);assert.equal(devices.living_room_light.state.power,'off');
    });
    await test('공간 변경 후 오래된 계획은 실행 전에 폐기된다',async()=>{
      const p=await plan('잠깐 쉴게');await move('living_room');
      const result=await run(p.plan_id);assert.equal(result.status,409);assert.equal(result.plan_stale,true);
    });
    await test('설정 변경 후 오래된 계획은 실행 전에 폐기된다',async()=>{
      const p=await plan('잠깐 쉴게');await request('/api/everyday/profile',{relax_brightness:28});
      assert.equal((await run(p.plan_id)).plan_stale,true);
    });
    await test('계획 생성 후 재실자가 들어오면 기존 계획은 실행되지 않는다',async()=>{
      const p=await plan('공부 시작할게');
      await request('/api/context-graph/actor',{actor_id:'family',present:true,location:'living_room'});
      assert.equal((await run(p.plan_id)).plan_stale,true);
    });
    await test('가족이 있는 거실 조명은 외출 계획에서 생략한다',async()=>{
      const p=await plan('나 이제 나갈게');assert.equal(p.ok,true);
      assert.equal(p.steps.find(s=>s.device==='living_room_light').status,'skipped');
      assert.equal(p.decision,'confirm');
      const before=devices.living_room_light.state.power;
      assert.equal((await request('/api/everyday/execute',{plan_id:p.plan_id})).status,409);
      const result=await run(p.plan_id);assert.equal(result.status,'completed');
      assert.equal(devices.living_room_light.state.power,before);
      assert.equal(result.everyday.session.status,'paused');
    });
    await test('부정·복합·불명확한 요청은 임의 행동을 만들지 않는다',async()=>{
      for(const text of ['불 켜지 마','거실 불 끄고 침실 켜줘','뭔가 해봐','공부 시작할게?'])assert.equal((await plan(text)).ok,false,text);
    });
    await test('애매한 앱 명령은 에러 대신 clarification 정보로 되묻는다',async()=>{
      const result=await plan('그거 켜줘');
      assert.equal(result.ok,false);assert.equal(result.needs_clarification,true);assert.match(result.question,/어떤/);
    });
    await test('개인 기기 권한은 일상 계획에서도 유지된다',async()=>{
      await request('/api/identity',{identity_id:'guest'});
      assert.equal((await plan('메모장 켜줘')).ok,false);
      assert.equal((await request('/api/everyday/profile',{name:'변경'})).status,403);
      assert.equal((await request('/api/everyday/session',{action:'pause'})).status,403);
      assert.equal((await plan('공부 시작할게')).ok,false);
      await request('/api/identity',{identity_id:'owner'});
    });
    await test('한 단계 실패는 부분 완료로 표시하고 활동을 시작하지 않는다',async()=>{
      await request('/api/context-graph/actor',{actor_id:'family',present:false});
      const before=(await request('/api/everyday')).session.id;
      const pc=require('../src/adapters/windows-pc-adapter'),original=pc.execute;
      pc.execute=()=>{throw new Error('test failure');};
      try{
        const p=await plan('공부 시작할게'),result=await run(p.plan_id);
        assert.equal(result.status,'partial');assert.equal(result.summary.failed,1);
        assert.equal(result.everyday.session.id,before);
        assert.equal((await run(p.plan_id)).status,400);
      }finally{pc.execute=original;}
    });
    const cfg={url:'http://ha.example:8123',token:'test-only-token',entities:{living_room_light:'light.test_living'}};
    await test('Home Assistant는 허용 조명만 등록한다',async()=>{
      assert.throws(()=>ha.validateConfig({...cfg,entities:{living_room_light:'lock.front_door'}}));
      assert.throws(()=>ha.validateConfig({...cfg,url:'file:///etc'}));
      assert.throws(()=>ha.validateConfig({...cfg,entities:{living_room_light:'light.same',bedroom_light:'light.same'}}));
    });
    await test('Home Assistant 밝기 명령은 REST 전송 후 상태를 다시 읽어 검증한다',async()=>{
      const calls=[],device={id:'living_room_light',state:{power:'off',brightness:10}};
      const fake=async(url,options)=>{calls.push({url,options});return {ok:true,json:async()=>options.method==='POST'?[]:{state:'on',attributes:{brightness:184}}};};
      const result=await ha.execute(device,'set_brightness',{brightness:72},{config:cfg,fetchImpl:fake});
      assert.equal(calls.length,2);assert.ok(calls[0].url.endsWith('/api/services/light/turn_on'));
      assert.deepEqual(JSON.parse(calls[0].options.body),{entity_id:'light.test_living',brightness_pct:72});
      assert.ok(calls[1].url.endsWith('/api/states/light.test_living'));assert.equal(result.state.brightness,72);
    });
    await test('기기 API 실패·unavailable·읽기 불일치가 성공으로 기록되지 않는다',async()=>{
      const device={id:'living_room_light',state:{power:'off',brightness:10}};
      await assert.rejects(ha.execute(device,'turn_on',{}, {config:cfg,fetchImpl:async()=>({ok:false,status:401})}));
      assert.equal(device.state.power,'off');
      await assert.rejects(ha.execute(device,'turn_on',{}, {config:cfg,fetchImpl:async()=>({ok:true,json:async()=>({state:'unavailable'})})}));
      await assert.rejects(ha.execute(device,'turn_on',{}, {config:cfg,fetchImpl:async()=>({ok:true,json:async()=>({state:'off',attributes:{brightness:0}})})}));
    });
    await test('비동기 기기 동작 중 중복 실행과 공간 변경을 차단한다',async()=>{
      const adapter=require('../src/adapters/virtual-light-alpha'),original=adapter.execute;
      let release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
      adapter.execute=async(...args)=>{entered();await gate;return original(...args);};
      try{
        await move('living_room');const p=await plan('거실 불 켜줘');
        const first=run(p.plan_id);await started;
        assert.equal((await run(p.plan_id)).status,423);assert.equal((await move('bedroom')).status,423);
        release();assert.equal((await first).status,'completed');
      }finally{release();adapter.execute=original;}
    });
    await test('사용 화면과 정적 파일을 제공하고 비밀 설정은 제공하지 않는다',async()=>{
      for(const file of ['/','/everyday.js','/everyday.css','/lab.html'])assert.equal((await fetch(base+file)).status,200);
      assert.equal((await fetch(base+'/config.local.json')).status,404);
      assert.equal((await fetch(base+'/../server.js')).status,404);
      const html=await (await fetch(base+'/')).text();assert.ok(html.includes('planDialog'));assert.ok(html.includes('clarifyDialog'));assert.ok(html.includes('appRegisterForm'));assert.ok(html.includes('음성 입력'));
    });
    console.log(`EVERYDAY TESTS PASSED: ${passed}`);
  }finally{await new Promise(resolve=>server.close(resolve));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
