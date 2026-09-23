'use strict';
const assert=require('assert');
const {devices,resetDeviceStates}=require('../src/devices');
const {buildActionIR}=require('../src/action-ir');
const {execute}=require('../src/executor');
const ledger=require('../src/action-ledger');

(async()=>{
  ledger.reset();resetDeviceStates();
  const actor={id:'owner_local'};

  // A persisted STARTED action from a previous process must become UNKNOWN on recovery.
  const interrupted=buildActionIR({device:devices.bedroom_light,legacyCapability:'turn_on',sourceText:'crash recovery',intent:'test',planId:'plan-crash',actor});
  ledger.start(interrupted,devices.bedroom_light);
  assert.equal(ledger.get(interrupted.id).status,'STARTED');
  const recovered=ledger.recoverInterrupted();
  assert.equal(recovered.length,1);
  const after=ledger.get(interrupted.id);
  assert.equal(after.status,'UNKNOWN');
  assert.equal(after.reconciliation.required,true);
  assert.equal(after.reconciliation.state,'REQUIRED');
  assert.equal(after.reconciliation.reason,'runtime_interrupted_before_terminal_outcome');
  assert.ok(after.evidence.some(e=>e.source==='runtime-recovery'));

  // The same logical action id must never be blindly dispatched again.
  let duplicateRejected=false;
  try { await execute(devices.bedroom_light,interrupted); }
  catch(error){ duplicateRejected=error.code==='ACTION_ALREADY_RECORDED'; }
  assert.equal(duplicateRejected,true);
  assert.equal(ledger.get(interrupted.id).status,'UNKNOWN');

  // UNKNOWN remains resolvable through the existing external-test reconciliation primitive.
  const reconciled=ledger.reconcile(interrupted.id,{outcome:'SUCCEEDED',evidence:{source:'adapter-readback',note:'observed expected state'}});
  assert.equal(reconciled.status,'SUCCEEDED');
  assert.equal(reconciled.reconciliation.required,false);

  console.log('V1.8.2 CRASH RECOVERY TESTS PASSED');
})().catch(e=>{console.error(e);process.exitCode=1});
