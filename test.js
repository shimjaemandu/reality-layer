'use strict';
process.env.PC_ADAPTER_DRY_RUN = '1';

const assert = require('assert');
const { devices, resetDeviceStates } = require('./src/devices');
const { interpret } = require('./src/intent');
const { executePcAction } = require('./src/windows-pc');
const { resolveApp, registerUserApp, getApp, normalizeExecutableInput } = require('./src/app-registry');
const { evaluate, publicPolicySpec } = require('./src/permission');
const { execute } = require('./src/executor');
const { buildUnifiedCommand, INTERFACE_VERSION } = require('./src/unified-command');
const { getIdentity, setIdentity, resetIdentity } = require('./src/identity');
const { setCurrentLocation, resetContext, getContext } = require('./src/context');
const { publicDeviceGraph, validateGraph, getDeviceGraphContext, graphSnapshotForDevice, validateGraphSnapshot, GRAPH_VERSION } = require('./src/device-graph');
const { publicContextGraph, setActorPresence, resetContextGraph, actionContext, contextGraphSnapshotForAction, validateContextGraphSnapshot, CONTEXT_GRAPH_VERSION } = require('./src/context-graph');
const { buildPlan, ORCHESTRATOR_VERSION } = require('./src/orchestrator');
const { server } = require('./server');
const {token}=require('./src/local-access');

function test(name, fn) {
  try { fn(); console.log(`PASS ${name}`); }
  catch (error) { console.error(`FAIL ${name}`); throw error; }
}

let asyncChain = Promise.resolve();
function asyncTest(name, fn) {
  asyncChain = asyncChain.then(async () => {
    try { await fn(); console.log(`PASS ${name}`); }
    catch (error) { console.error(`FAIL ${name}`); throw error; }
  });
  return asyncChain;
}

resetDeviceStates();
resetIdentity();
resetContext();
resetContextGraph();

test('모든 기기가 UAG/0.1 인터페이스와 Adapter를 가진다', () => {
  for (const device of Object.values(devices)) {
    assert.equal(device.interface_version, INTERFACE_VERSION);
    assert.ok(device.adapter_id);
    assert.ok(device.protocol);
    assert.ok(device.capabilities.length > 0);
  }
});

test('Reality Policy v1.4.3 + Device Graph + Context Graph 스펙이 존재한다', () => {
  const spec = publicPolicySpec();
  assert.equal(spec.version, 'reality-policy/1.4.3');
  assert.equal(spec.graph_version, GRAPH_VERSION);
  assert.equal(spec.context_graph_version, CONTEXT_GRAPH_VERSION);
  assert.deepEqual(spec.decisions, ['auto', 'confirm', 'blocked']);
});

test('데모 Identity는 실제 인증으로 표시되지 않지만 정책 실험에는 사용할 수 있다', () => {
  resetIdentity();
  const identity = getIdentity();
  assert.equal(identity.authenticated, false);
  assert.equal(identity.policy_identity, true);
  assert.equal(identity.identity_assurance, 'demo');
  assert.equal(identity.real_world_verified, false);
  const policy = evaluate(devices.living_room_light, 'turn_off', {}, { identity, context:getContext() });
  assert.equal(policy.allowed, true);
});

test('Device Graph 모든 edge가 실제 node를 가리킨다', () => {
  const validation = validateGraph();
  assert.equal(validation.ok, true, validation.issues.join(','));
  assert.ok(validation.node_count >= 5);
  assert.ok(validation.edge_count >= 10);
});

test('Device Graph가 소유자·공간·영향범위를 해석한다', () => {
  resetIdentity();
  const graph = getDeviceGraphContext('living_room_light', getIdentity());
  assert.equal(graph.owner_id, 'owner');
  assert.equal(graph.space.id, 'living_room');
  assert.equal(graph.impact_scope, 'shared_space');
  assert.equal(graph.actor_graph_access, true);
});

test('Graph snapshot은 현재 관계와 일치해야 한다', () => {
  const snapshot = graphSnapshotForDevice('front_door');
  assert.equal(validateGraphSnapshot(snapshot), true);
  assert.equal(validateGraphSnapshot({ ...snapshot, fingerprint:'tampered' }), false);
});

test('Context Graph가 사람 위치·공간 점유·기기 상태를 동적 relation으로 만든다', () => {
  resetContextGraph();
  setActorPresence('family', { present:true, location:'living_room' });
  const graph = publicContextGraph();
  assert.equal(graph.version, CONTEXT_GRAPH_VERSION);
  assert.equal(graph.validation.ok, true, graph.validation.issues.join(','));
  assert.ok(graph.edges.some((e)=>e.from === 'family' && e.to === 'living_room' && e.type === 'located_in'));
  assert.ok(graph.edges.some((e)=>e.from === 'living_room' && e.to === 'family' && e.type === 'occupied_by'));
  assert.ok(graph.edges.some((e)=>e.from === 'front_door' && e.to === 'state:front_door' && e.type === 'has_state'));
});

test('Context Graph action context는 영향 공간의 다른 재실자를 찾는다', () => {
  resetContextGraph();
  setActorPresence('owner', { present:true, location:'room' });
  setActorPresence('family', { present:true, location:'living_room' });
  const live = actionContext('living_room_light', 'owner');
  assert.equal(live.other_occupants.length, 1);
  assert.equal(live.other_occupants[0].id, 'family');
});

test('다른 사람이 거실에 있으면 Owner의 거실 조명 OFF는 AUTO 대신 CONFIRM', () => {
  resetIdentity(); resetContext(); resetContextGraph();
  setActorPresence('owner', { present:true, location:'room' });
  setActorPresence('family', { present:true, location:'living_room' });
  const policy = evaluate(devices.living_room_light, 'turn_off', {}, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, true);
  assert.equal(policy.level, 'confirm');
  assert.ok(policy.context_graph.other_occupants.some((o)=>o.id === 'family'));
});

test('다른 재실자가 없으면 Owner의 거실 조명 OFF는 AUTO', () => {
  resetIdentity(); resetContext(); resetContextGraph();
  setActorPresence('owner', { present:true, location:'room' });
  const policy = evaluate(devices.living_room_light, 'turn_off', {}, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.level, 'auto');
});

test('Context Graph snapshot은 관련 사람 위치나 기기 상태가 바뀌면 stale이 된다', () => {
  resetContextGraph(); resetDeviceStates();
  setActorPresence('owner', { present:true, location:'room' });
  setActorPresence('family', { present:true, location:'living_room' });
  const snapshot = contextGraphSnapshotForAction('living_room_light', 'owner');
  assert.equal(validateContextGraphSnapshot(snapshot), true);
  setActorPresence('family', { present:true, location:'bedroom' });
  assert.equal(validateContextGraphSnapshot(snapshot), false);
});


test('Reality Orchestrator v1.3이 외출 의도를 여러 현실 행동으로 분해한다', () => {
  resetIdentity(); resetContext(); resetContextGraph(); resetDeviceStates();
  setActorPresence('owner', { present:true, location:'room' });
  const plan = buildPlan('나 이제 나갈게', { identity:getIdentity(), context:getContext() });
  assert.equal(plan.ok, true);
  assert.equal(plan.orchestrator_version, ORCHESTRATOR_VERSION);
  assert.equal(plan.intent, 'leave_home');
  assert.ok(plan.steps.length >= 5);
  assert.ok(plan.steps.some((s)=>s.device === 'front_door' && s.capability === 'lock'));
  assert.equal(plan.decision, 'confirm');
});

test('Orchestrator는 다른 재실자가 있는 공간의 환경 변경을 자동 생략한다', () => {
  resetIdentity(); resetContext(); resetContextGraph(); resetDeviceStates();
  setActorPresence('owner', { present:true, location:'room' });
  setActorPresence('family', { present:true, location:'living_room' });
  const plan = buildPlan('나 이제 나갈게', { identity:getIdentity(), context:getContext() });
  const light = plan.steps.find((s)=>s.id === 'living_light_off');
  assert.equal(light.status, 'skipped');
  assert.match(light.skip_reason, /Family/);
});

test('Orchestrator의 각 실행 단계는 독립 Policy와 UAG 명령을 가진다', () => {
  resetIdentity(); resetContext(); resetContextGraph(); resetDeviceStates();
  const plan = buildPlan('공부 시작할게', { identity:getIdentity(), context:getContext() });
  const planned = plan.steps.filter((s)=>s.status === 'planned');
  assert.ok(planned.length >= 2);
  for (const step of planned) {
    assert.ok(step.policy);
    assert.ok(step.unified_command);
    assert.equal(step.unified_command.target.device_id, step.device);
  }
});

test('동일한 공통 turn_off 명령을 서로 다른 조명 Adapter에 전달할 수 있다', () => {
  const a = buildUnifiedCommand(devices.living_room_light, 'turn_off', {}, '거실 불 꺼줘');
  const b = buildUnifiedCommand(devices.bedroom_light, 'turn_off', {}, '침실 불 꺼줘');
  assert.equal(a.schema, 'uag/0.1');
  assert.equal(b.schema, 'uag/0.1');
  assert.equal(a.action, 'turn_off');
  assert.equal(b.action, 'turn_off');
  assert.notEqual(a.target.adapter_id, b.target.adapter_id);
});

test('Alpha/Beta 조명은 같은 UAG 명령을 서로 다른 native protocol로 번역한다', () => {
  const a = execute(devices.living_room_light, 'turn_off', {});
  const b = execute(devices.bedroom_light, 'turn_off', {});
  assert.deepEqual(a.gateway_trace.native_trace.translated_command, { cmd: 'POWER_OFF' });
  assert.deepEqual(b.gateway_trace.native_trace.translated_command, { power: 0 });
});

test('낮은 위험의 조명 제어는 Owner에게 AUTO', () => {
  resetIdentity();
  const policy = evaluate(devices.living_room_light, 'turn_off', {}, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, true);
  assert.equal(policy.level, 'auto');
  assert.equal(policy.risk, 'low');
});

test('Family/Guest는 Device Graph상 개인 노트북 제어가 차단된다', () => {
  setIdentity('family');
  let policy = evaluate(devices.my_laptop, 'open_app', { app:'chrome' }, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, false);
  assert.match(policy.reason, /Device Graph|개인/);
  setIdentity('guest');
  policy = evaluate(devices.my_laptop, 'open_app', { app:'chrome' }, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, false);
});

test('Guest는 공유 거실 조명을 제어할 수 있지만 private 침실 조명은 차단된다', () => {
  setIdentity('guest');
  let policy = evaluate(devices.living_room_light, 'turn_off', {}, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, true);
  assert.equal(policy.level, 'auto');
  policy = evaluate(devices.bedroom_light, 'turn_off', {}, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, false);
});

test('Guest는 중간 위험 앱 종료가 차단된다', () => {
  setIdentity('guest');
  const policy = evaluate(devices.my_laptop, 'close_app', { app:'chrome' }, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, false);
  assert.equal(policy.level, 'blocked');
});

test('Owner의 PC 종료는 확인 필요', () => {
  setIdentity('owner');
  const policy = evaluate(devices.my_laptop, 'power_action', { power_action:'shutdown' }, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, true);
  assert.equal(policy.level, 'confirm');
  assert.equal(policy.risk, 'high');
});

test('Guest의 현관문 잠금 해제는 차단된다', () => {
  setIdentity('guest');
  setCurrentLocation('entrance');
  const policy = evaluate(devices.front_door, 'unlock', {}, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, false);
  assert.equal(policy.level, 'blocked');
});

test('Owner도 현관 Context 없이는 잠금 해제할 수 없다', () => {
  setIdentity('owner');
  setCurrentLocation('living_room');
  const policy = evaluate(devices.front_door, 'unlock', {}, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, false);
  assert.match(policy.reason, /현관/);
});

test('Owner + 현관 Context에서는 잠금 해제가 CONFIRM', () => {
  setIdentity('owner');
  setCurrentLocation('entrance');
  const policy = evaluate(devices.front_door, 'unlock', {}, { identity:getIdentity(), context:getContext() });
  assert.equal(policy.allowed, true);
  assert.equal(policy.level, 'confirm');
  assert.equal(policy.risk, 'high');
});

test('현관문 자연어 명령이 UAG 행동으로 해석된다', () => {
  const parsed = interpret('현관문 열어줘', {});
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action.device, 'front_door');
  assert.equal(parsed.action.capability, 'unlock');
});

test('가상 Door Adapter는 lock/unlock을 native 명령으로 번역한다', () => {
  const locked = execute(devices.front_door, 'lock', {});
  assert.equal(locked.lock, 'locked');
  const unlocked = execute(devices.front_door, 'unlock', {});
  assert.equal(unlocked.lock, 'unlocked');
  assert.deepEqual(unlocked.gateway_trace.native_trace.translated_command, { opcode:'LOCK_SET', value:0 });
});

const commandCases = [
  ['거실 불 꺼줘', 'living_room_light', 'turn_off'],
  ['거실 조명 밝기 80%로 해줘', 'living_room_light', 'set_brightness'],
  ['침실 불 켜줘', 'bedroom_light', 'turn_on'],
  ['안내판에 점검 중이라고 표시해줘', 'room_display', 'display_message'],
  ['계산기 켜줘', 'my_laptop', 'open_app'],
  ['유튜브 열어줘', 'my_laptop', 'open_site'],
  ['구글에서 양자역학 검색해줘', 'my_laptop', 'web_search'],
  ['다운로드 폴더 열어줘', 'my_laptop', 'open_folder'],
  ['현관문 잠가줘', 'front_door', 'lock'],
  ['현관문 열어줘', 'front_door', 'unlock'],
];

for (const [text, device, capability] of commandCases) {
  test(`자연어: ${text}`, () => {
    const parsed = interpret(text, { current_location: 'living_room' });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.action.device, device);
    assert.equal(parsed.action.capability, capability);
  });
}


test('YouTube 검색어는 문서/폴더가 아니라 web_search로 정확히 해석된다', () => {
  const parsed = interpret('유튜브에서 상대성이론 검색해줘', {});
  assert.equal(parsed.ok, true);
  assert.equal(parsed.action.capability, 'web_search');
  assert.equal(parsed.action.args.provider, 'youtube');
  assert.equal(parsed.action.args.query, '상대성이론');
});

test('웹 검색 실행은 explorer.exe보다 Microsoft Edge를 우선한다', () => {
  const calls=[];
  const env={PROGRAMFILES:'C:\\Program Files','PROGRAMFILES(X86)':'C:\\Program Files (x86)',LOCALAPPDATA:'C:\\Users\\tester\\AppData\\Local',PATH:''};
  const edge='C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  const fsImpl={existsSync:(value)=>value===edge,readdirSync:()=>[]};
  const result=executePcAction('web_search',{provider:'youtube',query:'상대성이론'},{platform:'win32',dryRun:true,env,fsImpl,spawnImpl:(command,args)=>{calls.push({command,args});return {unref(){}};}});
  assert.equal(result.browser,'edge');
  assert.notEqual(result.command,'explorer.exe');
  assert.match(result.args[0],/youtube\.com\/results\?search_query=/);
});

test('VS Code 자동 탐색은 Program Files (x86) 경로까지 확인한다', () => {
  const env={PROGRAMFILES:'C:\\Program Files','PROGRAMFILES(X86)':'D:\\Apps',LOCALAPPDATA:'C:\\Users\\tester\\AppData\\Local',USERPROFILE:'C:\\Users\\tester',PATH:''};
  const expected='D:\\Apps\\Microsoft VS Code\\Code.exe';
  const fsImpl={existsSync:(value)=>value===expected,readdirSync:()=>[]};
  const resolved=resolveApp('vscode',{env,fsImpl});
  assert.equal(resolved.executable,expected);
});

test('VS Code 표준 경로와 PATH가 없어도 Windows 시작 메뉴에서 자동 발견한다', () => {
  const env={PROGRAMFILES:'C:\\Program Files','PROGRAMFILES(X86)':'C:\\Program Files (x86)',LOCALAPPDATA:'C:\\Users\\tester\\AppData\\Local',USERPROFILE:'C:\\Users\\tester',PATH:''};
  const fsImpl={existsSync:()=>false,readdirSync:()=>[]};
  const spawnSyncImpl=(command,args)=>{
    if (command==='where.exe') return {status:1,stdout:'',stderr:''};
    if (command==='powershell.exe') return {status:0,stdout:JSON.stringify([{Name:'Visual Studio Code',AppID:'Microsoft.VisualStudioCode_abc!App'}]),stderr:''};
    return {status:1,stdout:'',stderr:''};
  };
  const resolved=resolveApp('vscode',{platform:'win32',env,fsImpl,spawnSyncImpl,noCache:true});
  assert.equal(resolved.launch_method,'start_app');
  assert.equal(resolved.discovered_by,'start_menu');
  assert.equal(resolved.start_app_name,'Visual Studio Code');
  assert.equal(resolved.shell_app_id,'Microsoft.VisualStudioCode_abc!App');
});

test('앱 경로 입력은 따옴표·환경변수·추가 인자를 정리한다', () => {
  const env={LOCALAPPDATA:'C:\\Users\\tester\\AppData\\Local'};
  const value=normalizeExecutableInput('"%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\Code.exe" --reuse-window',env);
  assert.equal(value,'C:\\Users\\tester\\AppData\\Local\\Programs\\Microsoft VS Code\\Code.exe');
});

test('시작 메뉴에서 찾은 VS Code는 AppsFolder 경로로 실행한다', () => {
  const env={PROGRAMFILES:'C:\\Program Files','PROGRAMFILES(X86)':'C:\\Program Files (x86)',LOCALAPPDATA:'C:\\Users\\tester\\AppData\\Local',USERPROFILE:'C:\\Users\\tester',PATH:''};
  const fsImpl={existsSync:()=>false,readdirSync:()=>[]};
  const spawnSyncImpl=(command,args)=>{
    if (command==='where.exe') return {status:1,stdout:'',stderr:''};
    if (command==='powershell.exe') return {status:0,stdout:JSON.stringify([{Name:'Visual Studio Code',AppID:'Microsoft.VisualStudioCode_abc!App'}]),stderr:''};
    return {status:1,stdout:'',stderr:''};
  };
  const result=executePcAction('open_app',{app:'vscode'},{platform:'win32',dryRun:true,env,fsImpl,spawnSyncImpl,noCache:true});
  assert.equal(result.command,'explorer.exe');
  assert.equal(result.args[0],'shell:AppsFolder\\Microsoft.VisualStudioCode_abc!App');
});

test('애매한 단일 명령은 임의 실행 대신 clarification을 반환한다', () => {
  resetDeviceStates();
  const parsed=interpret('그거 켜줘',{});
  assert.equal(parsed.ok,false);
  assert.equal(parsed.needs_clarification,true);
  assert.match(parsed.question,/어떤/);
});

test('사용자가 명시적으로 등록한 Windows 앱 경로는 Registry에 추가된다', () => {
  const registered=registerUserApp({id:'testeditor',name:'Test Editor',path:'C:\\Tools\\TestEditor.exe',aliases:['테스트 에디터']},{platform:'linux'});
  assert.equal(registered.id,'testeditor');
  const loaded=getApp('testeditor');
  assert.equal(loaded.paths[0],'C:\\Tools\\TestEditor.exe');
});

asyncTest('HTTP: Owner 조명 AUTO 실행', async () => {
  resetIdentity(); resetContext(); resetContextGraph(); resetDeviceStates();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    let res = await fetch(`${base}/api/reality-policy`);
    let data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.policy.version, 'reality-policy/1.4.3');
    assert.equal(data.identity.id, 'owner');

    res = await fetch(`${base}/api/device-registry`);
    data = await res.json();
    assert.equal(data.devices.length, 5);
    assert.ok(data.adapters.length >= 5);

    res = await fetch(`${base}/api/device-graph`);
    data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.graph.version, 'reality-device-graph/1.1');
    assert.equal(data.graph.validation.ok, true);

    res = await fetch(`${base}/api/context-graph`);
    data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.graph.version, CONTEXT_GRAPH_VERSION);
    assert.equal(data.graph.validation.ok, true);

    res = await fetch(`${base}/api/interpret`, {
      method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({text:'거실 불 꺼줘'}),
    });
    data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.policy.level, 'auto');
    assert.equal(data.policy.actor.role, 'owner');

    res = await fetch(`${base}/api/execute`, {
      method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({request_id:data.request_id}),
    });
    const executed = await res.json();
    assert.equal(executed.ok, true);
    assert.equal(executed.device.state.power, 'off');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

asyncTest('HTTP: 민감 행동은 Identity + Context + 확인을 모두 요구한다', async () => {
  resetIdentity(); resetContext(); resetContextGraph(); resetDeviceStates();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fetch(`${base}/api/identity`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({identity_id:'owner'}) });
    await fetch(`${base}/api/context`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({current_location:'entrance'}) });

    let res = await fetch(`${base}/api/interpret`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({text:'현관문 열어줘'}) });
    let data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.policy.level, 'confirm');
    const requestId = data.request_id;

    res = await fetch(`${base}/api/execute`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({request_id:requestId}) });
    data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.needs_confirmation, true);

    res = await fetch(`${base}/api/execute`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({request_id:requestId, confirmed:true}) });
    data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.device.state.lock, 'unlocked');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

asyncTest('HTTP: Identity 변경 시 대기 중 명령은 무효화된다', async () => {
  resetIdentity(); resetContext(); resetContextGraph(); resetDeviceStates();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fetch(`${base}/api/identity`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({identity_id:'owner'}) });
    let res = await fetch(`${base}/api/interpret`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({text:'거실 불 켜줘'}) });
    let data = await res.json();
    assert.equal(data.ok, true);
    const requestId = data.request_id;

    await fetch(`${base}/api/identity`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({identity_id:'guest'}) });
    res = await fetch(`${base}/api/execute`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({request_id:requestId}) });
    data = await res.json();
    assert.equal(res.status, 400); // identity switch intentionally clears pending requests
    assert.equal(data.ok, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


asyncTest('HTTP: Context Graph 변화는 대기 중 행동을 실행 직전에 무효화한다', async () => {
  resetIdentity(); resetContext(); resetContextGraph(); resetDeviceStates();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fetch(`${base}/api/context-graph/actor`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({actor_id:'family', present:true, location:'living_room'}) });
    let res = await fetch(`${base}/api/interpret`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({text:'거실 불 꺼줘'}) });
    let data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.policy.level, 'confirm');
    const requestId = data.request_id;

    await fetch(`${base}/api/context-graph/actor`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({actor_id:'family', present:true, location:'bedroom'}) });
    res = await fetch(`${base}/api/execute`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({request_id:requestId, confirmed:true}) });
    data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.context_graph_changed, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});


asyncTest('HTTP: Orchestrator가 외출 계획을 만들고 확인 후 순서대로 실행한다', async () => {
  resetIdentity(); resetContext(); resetContextGraph(); resetDeviceStates();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    let res = await fetch(`${base}/api/orchestrator`);
    let data = await res.json();
    assert.equal(data.orchestrator.version, ORCHESTRATOR_VERSION);

    res = await fetch(`${base}/api/orchestrate-plan`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({text:'나 이제 나갈게'}) });
    data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.intent, 'leave_home');
    assert.equal(data.decision, 'confirm');
    const planId = data.plan_id;

    res = await fetch(`${base}/api/orchestrate-execute`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({plan_id:planId}) });
    let needs = await res.json();
    assert.equal(res.status, 409);
    assert.equal(needs.needs_confirmation, true);

    res = await fetch(`${base}/api/orchestrate-execute`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({plan_id:planId, confirmed:true}) });
    data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.status, 'completed');
    assert.ok(data.summary.executed >= 1);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

asyncTest('HTTP: 계획 생성 후 Context Graph가 바뀌면 Orchestrator는 전체 계획을 stale 처리한다', async () => {
  resetIdentity(); resetContext(); resetContextGraph(); resetDeviceStates();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    let res = await fetch(`${base}/api/orchestrate-plan`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({text:'나 잘게'}) });
    let data = await res.json();
    assert.equal(data.ok, true);
    const planId = data.plan_id;

    await fetch(`${base}/api/context-graph/actor`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({actor_id:'family', present:true, location:'living_room'}) });
    res = await fetch(`${base}/api/orchestrate-execute`, { method:'POST', headers:{'Content-Type':'application/json','X-Reality-Token':token}, body:JSON.stringify({plan_id:planId, confirmed:true}) });
    data = await res.json();
    assert.equal(res.status, 409);
    assert.equal(data.plan_stale, true);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

asyncChain.then(() => console.log('ALL TESTS PASSED')).catch(() => { process.exitCode = 1; });
