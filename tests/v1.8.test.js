'use strict';
const assert=require('assert');
const {devices,resetDeviceStates}=require('../src/devices');
const {buildActionIR}=require('../src/action-ir');
const {execute}=require('../src/executor');
const ledger=require('../src/action-ledger');
(async()=>{ledger.reset();resetDeviceStates();const actor={id:'owner_local'};const ir=buildActionIR({device:devices.living_room_light,legacyCapability:'turn_on',sourceText:'test',intent:'test',planId:'plan-test',actor});const result=await execute(devices.living_room_light,ir);assert.equal(result.gateway_trace.action_id,ir.id);assert.equal(result.gateway_trace.outcome,'SUCCEEDED');const saved=ledger.get(ir.id);assert.equal(saved.status,'SUCCEEDED');assert.equal(saved.provenance.plan_id,'plan-test');const unknown=buildActionIR({device:devices.bedroom_light,legacyCapability:'turn_off',sourceText:'unknown-test',intent:'test',planId:'plan-unknown',actor}); ledger.start(unknown,devices.bedroom_light); ledger.transition(unknown.id,'UNKNOWN',{source:'test',note:'transport lost after dispatch'}); assert.equal(ledger.get(unknown.id).status,'UNKNOWN'); assert.equal(typeof ledger.reconcile,'undefined'); assert.equal(ledger.get(unknown.id).status,'UNKNOWN'); console.log('V1.8 TESTS PASSED');})().catch(e=>{console.error(e);process.exitCode=1});
