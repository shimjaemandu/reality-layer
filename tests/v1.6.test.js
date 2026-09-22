'use strict';
process.env.REALITY_LIVE='0';process.env.PC_ADAPTER_DRY_RUN='1';
const assert=require('node:assert/strict');
const {devices,resetDeviceStates}=require('../src/devices');
const {resetSensors}=require('../src/sensors');
const {REALITY_GRAPH_VERSION,publicRealityGraph,validateRealityGraph}=require('../src/reality-graph');
const {STATE_STORE_VERSION,publicStateStore,getActorState,getDeviceState,setActorState,resetStateStore}=require('../src/state-store');
const {EVENT_STORE_VERSION,appendEvent,readEvents,resetEventStore}=require('../src/event-store');
const {CONTEXT_GRAPH_VERSION,publicContextGraph,setActorPresence,resetContextGraph,actionContext}=require('../src/context-graph');
const {buildActionIR}=require('../src/action-ir');
const {execute}=require('../src/executor');
const {server}=require('../server');
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
(async()=>{
  resetDeviceStates();resetSensors();resetStateStore();resetEventStore();resetContextGraph();

  await test('Reality Graph 1.6은 topology만 보관하고 실시간 상태를 포함하지 않는다',async()=>{
    const graph=publicRealityGraph();
    assert.equal(graph.version,REALITY_GRAPH_VERSION);
    assert.equal(graph.version,'reality-graph/1.6');
    assert.equal(graph.separation.contains_live_device_state,false);
    assert.equal(graph.separation.contains_actor_presence,false);
    assert.ok(!graph.nodes.some(n=>n.kind==='device_state'));
    assert.ok(!graph.edges.some(e=>e.dynamic===true||['occupied_by','has_state'].includes(e.type)));
    assert.equal(validateRealityGraph().ok,true);
  });

  await test('State Store 1.6은 Actor/Device/Sensor의 현재값을 별도 보관한다',async()=>{
    const state=publicStateStore();
    assert.equal(state.version,STATE_STORE_VERSION);
    assert.ok(state.actors.owner);
    assert.equal(state.devices.bedroom_light.state.brightness,55);
    assert.ok(state.sensors.bedroom_motion);
    assert.equal(state.layer,'current-state');
  });

  await test('Actor 위치 변경은 State Store만 변경하고 Reality Graph topology를 오염시키지 않는다',async()=>{
    const before=JSON.stringify(publicRealityGraph());
    setActorPresence('family',{present:true,location:'living_room',source:'test',confidence:1});
    assert.equal(getActorState('family').location,'living_room');
    const graph=publicRealityGraph();
    assert.equal(JSON.stringify(graph),before);
    assert.ok(!graph.edges.some(e=>e.type==='occupied_by'));
  });

  await test('Context Graph는 Reality Graph + State Store의 compatibility projection이다',async()=>{
    const graph=publicContextGraph();
    assert.equal(graph.version,CONTEXT_GRAPH_VERSION);
    assert.equal(graph.projection,true);
    assert.equal(graph.sources.reality_graph,REALITY_GRAPH_VERSION);
    assert.equal(graph.sources.state_store,STATE_STORE_VERSION);
    assert.ok(graph.edges.some(e=>e.type==='occupied_by'&&e.to==='family'));
    const context=actionContext('living_room_light','owner');
    assert.ok(context.other_occupants.some(o=>o.id==='family'));
  });

  await test('Executor 실행은 State Store 최신값과 Event Store 실행 이력을 동시에 갱신한다',async()=>{
    resetEventStore();
    const ir=buildActionIR({device:devices.bedroom_light,legacyCapability:'set_brightness',args:{brightness:83},sourceText:'침실 밝기 83',intent:'direct_command',actor:{id:'owner'}});
    const result=await execute(devices.bedroom_light,ir);
    assert.equal(result.brightness,83);
    assert.equal(getDeviceState('bedroom_light').state.brightness,83);
    const events=readEvents({type:'device.action.executed'});
    assert.equal(events.length,1);
    assert.equal(events[0].schema,EVENT_STORE_VERSION);
    assert.equal(events[0].target_id,'bedroom_light');
    assert.equal(events[0].payload.capability,'set_brightness');
  });

  await test('Event Store는 순서가 있는 append-only history를 제공한다',async()=>{
    resetEventStore();
    const a=appendEvent({type:'test.first',source:'test',payload:{value:1}});
    const b=appendEvent({type:'test.second',source:'test',payload:{value:2}});
    const events=readEvents();
    assert.equal(events.length,2);
    assert.equal(a.sequence,1);
    assert.equal(b.sequence,2);
    assert.equal(events[0].type,'test.first');
    assert.equal(events[1].type,'test.second');
  });

  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const base=`http://127.0.0.1:${server.address().port}`;
  const token=(await (await fetch(base+'/api/session')).json()).token;
  const req=async(route,body)=>{const r=await fetch(base+route,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json','X-Reality-Token':token},...(body===undefined?{}:{body:JSON.stringify(body)})});return {status:r.status,...await r.json()};};
  try{
    await test('HTTP API가 Reality Graph / State Store / Event Store를 각각 노출한다',async()=>{
      const graph=await req('/api/reality-graph');
      const state=await req('/api/state-store');
      const events=await req('/api/event-store');
      assert.equal(graph.graph.version,REALITY_GRAPH_VERSION);
      assert.equal(state.state_store.version,STATE_STORE_VERSION);
      assert.equal(events.event_store.version,EVENT_STORE_VERSION);
    });
    await test('센서 HTTP 이벤트는 현재값과 과거이력을 서로 다른 Store에 기록한다',async()=>{
      resetEventStore();
      const out=await req('/api/sensor-event',{sensor_id:'bedroom_motion',detected:true});
      assert.equal(out.ok,true);
      const state=await req('/api/state-store');
      const events=await req('/api/event-store');
      assert.equal(state.state_store.sensors.bedroom_motion.state.detected,true);
      assert.ok(events.event_store.events.some(e=>e.type==='sensor.observation'&&e.target_id==='bedroom_motion'));
    });
  }finally{await new Promise(resolve=>server.close(resolve));}

  console.log(`V1.6 TESTS PASSED (${passed})`);
})().catch(err=>{console.error(err);process.exitCode=1;});
