'use strict';
process.env.REALITY_LIVE='0';process.env.PC_ADAPTER_DRY_RUN='1';
const assert=require('node:assert/strict');
const {devices,resetDeviceStates}=require('../src/devices');
const {CAPABILITY_MODEL_VERSION,capabilitiesForDevice,validateCapabilityAction,legacyToCapability,capabilityToLegacy}=require('../src/capability-model');
const {ACTION_IR_VERSION,buildActionIR,validateActionIR,actionIRToLegacy}=require('../src/action-ir');
const {execute}=require('../src/executor');
const {buildPlan}=require('../src/orchestrator');
const {getIdentity,resetIdentity}=require('../src/identity');
const {getContext,resetContext}=require('../src/context');
const {resetContextGraph}=require('../src/context-graph');
const {server}=require('../server');
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  await test('Capability Model 1.0이 기기 타입별 capability를 선언한다',async()=>{
    const light=capabilitiesForDevice(devices.living_room_light);
    assert.equal(CAPABILITY_MODEL_VERSION,'reality-capability/1.0');
    assert.ok(light.find(c=>c.id==='power'&&c.kind==='property'));
    assert.ok(light.find(c=>c.id==='brightness'&&c.input_schema.properties.value.maximum===100));
    const pc=capabilitiesForDevice(devices.my_laptop);
    assert.ok(pc.find(c=>c.id==='application.launch'));
    assert.ok(pc.find(c=>c.id==='web.search'));
  });
  await test('Capability 입력 타입과 범위를 강제한다',async()=>{
    assert.doesNotThrow(()=>validateCapabilityAction(devices.bedroom_light,'brightness','write',{value:80}));
    assert.throws(()=>validateCapabilityAction(devices.bedroom_light,'brightness','write',{value:101}),/최대값/);
    assert.throws(()=>validateCapabilityAction(devices.bedroom_light,'power','write',{value:'blink'}),/허용 범위/);
  });
  await test('기존 UAG 동작은 Capability semantics로 양방향 변환된다',async()=>{
    assert.deepEqual(legacyToCapability(devices.living_room_light,'turn_off',{}),{capability_id:'power',operation:'write',input:{value:'off'}});
    assert.deepEqual(capabilityToLegacy(devices.living_room_light,'power','write',{value:'off'}),{capability:'turn_off',args:{}});
    assert.deepEqual(capabilityToLegacy(devices.my_laptop,'application.launch','invoke',{app:'calculator'}),{capability:'open_app',args:{app:'calculator'}});
  });
  await test('Typed Action IR이 target/capability/operation/semantics/provenance를 고정한다',async()=>{
    const ir=buildActionIR({device:devices.bedroom_light,legacyCapability:'set_brightness',args:{brightness:77},sourceText:'침실 밝기 77',intent:'direct_command',actor:{id:'owner'}});
    assert.equal(ir.schema,ACTION_IR_VERSION);
    assert.equal(ir.target.device_id,'bedroom_light');
    assert.equal(ir.capability.id,'brightness');
    assert.equal(ir.operation,'write');
    assert.deepEqual(ir.input,{value:77});
    assert.equal(ir.semantics.risk,'low');
    assert.equal(ir.provenance.actor_id,'owner');
    assert.doesNotThrow(()=>validateActionIR(ir,devices.bedroom_light));
    assert.deepEqual(actionIRToLegacy(ir,devices.bedroom_light),{capability:'set_brightness',args:{brightness:77}});
  });
  await test('Executor는 Action IR을 검증한 뒤 기존 Adapter bridge로 실행한다',async()=>{
    resetDeviceStates();
    const ir=buildActionIR({device:devices.living_room_light,legacyCapability:'turn_on',args:{},sourceText:'거실 불 켜'});
    const state=await execute(devices.living_room_light,ir);
    assert.equal(state.power,'on');
    assert.equal(state.gateway_trace.action_ir.schema,ACTION_IR_VERSION);
    assert.equal(state.gateway_trace.compatibility_bridge.legacy_capability,'turn_on');
  });
  await test('Orchestrator 계획의 실행 단계마다 Typed Action IR이 포함된다',async()=>{
    resetIdentity();resetContext();resetContextGraph();resetDeviceStates();
    const plan=buildPlan('공부 시작할게',{identity:getIdentity(),context:getContext()});
    assert.equal(plan.ok,true);
    for(const step of plan.steps.filter(s=>s.status==='planned')) assert.equal(step.action_ir.schema,ACTION_IR_VERSION);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}`;
  const token=(await (await fetch(base+'/api/session')).json()).token;
  const req=async(route,body)=>{const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Reality-Token':token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,...await r.json()};};
  try{
    await test('Device Registry가 Capability Model과 Action IR 스펙을 노출한다',async()=>{
      const data=await req('/api/device-registry');
      assert.equal(data.action_ir.version,ACTION_IR_VERSION);
      assert.equal(data.capability_model.version,CAPABILITY_MODEL_VERSION);
      assert.equal(data.interface.status,'compatibility-layer');
      assert.ok(data.devices.find(d=>d.id==='my_laptop').capability_model.find(c=>c.id==='application.launch'));
    });
    await test('자연어 해석 결과에 Typed Action IR이 생성된다',async()=>{
      const data=await req('/api/interpret',{text:'계산기 켜줘'});
      assert.equal(data.ok,true);
      assert.equal(data.action_ir.schema,ACTION_IR_VERSION);
      assert.equal(data.action_ir.capability.id,'application.launch');
      assert.equal(data.action_ir.input.app,'calculator');
    });
  }finally{await new Promise(resolve=>server.close(resolve));}
  console.log(`V1.5 TESTS PASSED (${passed})`);
})().catch(err=>{console.error(err);process.exitCode=1;});
