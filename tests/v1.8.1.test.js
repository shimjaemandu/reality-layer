'use strict';
const assert=require('assert');
const {server}=require('../server');
const mcpAccess=require('../src/mcp-access');
const ledger=require('../src/action-ledger');
const {devices,resetDeviceStates}=require('../src/devices');
const {resetContext}=require('../src/context');
const {resetContextGraph}=require('../src/context-graph');
const {resetStateStore}=require('../src/state-store');
const {resetEventStore}=require('../src/event-store');
const {resetIdentity}=require('../src/identity');
const {buildActionIR}=require('../src/action-ir');
const {RealityLayerAdapter}=require('../integrations/langgraph/reality-layer-adapter');

(async()=>{
  process.env.PC_ADAPTER_DRY_RUN='1';
  ledger.reset(); resetDeviceStates(); resetContext(); resetIdentity(); resetStateStore(); resetEventStore(); resetContextGraph();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const rl=new RealityLayerAdapter({baseUrl,token:mcpAccess.token,clientName:'v181-test-agent'});
  try {
    const plan=await rl.plan('침실 불 켜줘');
    assert.equal(plan.ok,true); assert.equal(plan.decision,'auto');
    assert.equal(plan.steps[0].action_ir.provenance.plan_id,plan.plan_id);

    const result=await rl.execute(plan.plan_id);
    assert.equal(result.ok,true); assert.equal(result.status,'completed');
    assert.equal(result.actions.length,1); assert.equal(result.reconciliation_required,false);
    assert.ok(result.action.action_id); assert.equal(result.action.outcome,'SUCCEEDED');
    assert.equal(result.action.provenance.plan_id,plan.plan_id);
    assert.equal(result.action.reconciliation.required,false);

    const status=await rl.actionStatus(result.action.action_id);
    assert.equal(status.ok,true); assert.equal(status.action.status,'SUCCEEDED');

    const unknown=buildActionIR({device:devices.living_room_light,legacyCapability:'turn_off',sourceText:'unknown harness test',intent:'test',planId:'plan-unknown-181',actor:{id:'owner'}});
    ledger.start(unknown,devices.living_room_light);
    ledger.transition(unknown.id,'UNKNOWN',{source:'test',note:'transport lost after dispatch'});
    const before=await rl.actionStatus(unknown.id);
    assert.equal(before.reconciliation.required,true);
    const reconciled=await rl.reconcile(unknown.id);
    assert.equal(reconciled.ok,true); assert.equal(reconciled.changed,false); assert.equal(reconciled.action.status,'UNKNOWN');
    assert.equal(reconciled.reconciliation.state,'REQUIRED');

    console.log('V1.8.1 TESTS PASSED');
  } finally { await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{console.error(e);process.exitCode=1});
