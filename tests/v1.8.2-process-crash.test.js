'use strict';
const assert=require('assert');
const {spawnSync}=require('child_process');
const ledger=require('../src/action-ledger');

ledger.reset();
const actionId='process-crash-recovery-fixture';
const childCode=`
  const ledger=require('./src/action-ledger');
  ledger.start({id:${JSON.stringify(actionId)},target:{device_id:'bedroom_light'},provenance:{plan_id:'process-crash-plan'}},{id:'bedroom_light'});
  process.exit(91);
`;
const child=spawnSync(process.execPath,['-e',childCode],{cwd:require('path').join(__dirname,'..'),stdio:'inherit'});
assert.equal(child.status,91);
assert.equal(ledger.get(actionId).status,'STARTED');
const recovered=ledger.recoverInterrupted();
assert.equal(recovered.length,1);
const action=ledger.get(actionId);
assert.equal(action.status,'UNKNOWN');
assert.equal(action.reconciliation.required,true);
assert.equal(action.reconciliation.reason,'runtime_interrupted_before_terminal_outcome');
console.log('V1.8.2 PROCESS CRASH/RESTART TEST PASSED');
