'use strict';
const assert=require('assert');
const {server}=require('../server');
const mcpAccess=require('../src/mcp-access');
const ledger=require('../src/action-ledger');
const {devices,resetDeviceStates}=require('../src/devices');
const {buildActionIR}=require('../src/action-ir');
const {RealityLayerAdapter}=require('../integrations/langgraph/reality-layer-adapter');

(async()=>{
  ledger.reset(); resetDeviceStates();
  const ir=buildActionIR({device:devices.bedroom_light,legacyCapability:'turn_off',sourceText:'trusted reconciliation test',intent:'test',planId:'plan-trusted-reconcile',actor:{id:'owner'}});
  ledger.start(ir,devices.bedroom_light);
  ledger.transition(ir.id,'UNKNOWN',{source:'test',reason:'post_dispatch_outcome_uncertain'});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const baseUrl=`http://127.0.0.1:${server.address().port}`;
  const rl=new RealityLayerAdapter({baseUrl,token:mcpAccess.token,clientName:'trusted-reconciliation-test'});
  try {
    // Public reconciliation accepts only action_id. Caller-selected outcome/evidence is rejected by schema.
    let rejected=false;
    try { await rl.call('reality.action.reconcile',{action_id:ir.id,outcome:'SUCCEEDED',evidence_note:'trust me'}); }
    catch(error){ rejected=true; }
    assert.equal(rejected,true);
    assert.equal(ledger.get(ir.id).status,'UNKNOWN');

    // Unsupported adapters cannot be terminally resolved by caller assertion.
    const result=await rl.reconcile(ir.id);
    assert.equal(result.ok,true);
    assert.equal(result.changed,false);
    assert.equal(result.action.status,'UNKNOWN');
    assert.equal(result.reconciliation.state,'REQUIRED');
    assert.equal(ledger.get(ir.id).status,'UNKNOWN');

    // Even the ledger terminal reconciliation path requires an unforgeable in-process authority token.
    assert.throws(()=>ledger.reconcileTrusted(ir.id,{outcome:'SUCCEEDED',evidence:{source:'caller'}}),/Trusted reconciliation authority required/);
    console.log('V1.8.2.1 TRUSTED RECONCILIATION TEST PASSED');
  } finally { await new Promise(resolve=>server.close(resolve)); }
})().catch(e=>{console.error(e);process.exitCode=1});
