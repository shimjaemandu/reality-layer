'use strict';
const { executeThroughAdapter } = require('./adapters');
const { validateActionIR, actionIRToLegacy } = require('./action-ir');
const { syncDeviceState } = require('./state-store');
const { appendEvent } = require('./event-store');
const ledger = require('./action-ledger');

function execute(device, capabilityOrIR, args = {}) {
  let capability=capabilityOrIR, actualArgs=args, actionIR=null;
  if (capabilityOrIR && typeof capabilityOrIR === 'object' && capabilityOrIR.schema) {
    actionIR=capabilityOrIR;
    validateActionIR(actionIR,device);
    const legacy=actionIRToLegacy(actionIR,device);
    capability=legacy.capability; actualArgs=legacy.args;
  }
  if (actionIR) ledger.start(actionIR, device);
  try {
    const result = executeThroughAdapter(device, capability, actualArgs);
    if (result && typeof result.then === 'function') {
      return result.then(value => trace(device, capability, actualArgs, value, actionIR)).catch(error => { recordFailure(actionIR,error); throw error; });
    }
    return trace(device, capability, actualArgs, result, actionIR);
  } catch (error) { recordFailure(actionIR,error); throw error; }
}

function recordFailure(actionIR,error) {
  if (!actionIR) return;
  const unknown = error?.executionOutcomeUnknown === true;
  ledger.transition(actionIR.id, unknown ? 'UNKNOWN' : 'FAILED', { source:'executor', error:String(error?.message || error), outcome_unknown:unknown });
  appendEvent({ type:unknown?'action.outcome.unknown':'action.outcome.failed', source:'executor', actor_id:actionIR?.provenance?.actor_id || null, target_id:actionIR.id, payload:{ action_id:actionIR.id, error:String(error?.message || error) } });
}

function trace(device, capability, args, result, actionIR=null) {
  const currentState = result?.state || device.state || {};
  syncDeviceState(device.id, currentState, 'adapter');
  if (actionIR) ledger.transition(actionIR.id, result?.outcome === 'unknown' ? 'UNKNOWN' : 'SUCCEEDED', { source:'adapter', adapter_id:device.adapter_id, native_trace:result?.native_trace || null });
  appendEvent({
    type:'device.action.executed',
    source:'executor',
    actor_id:actionIR?.provenance?.actor_id || null,
    target_id:device.id,
    payload:{ capability, args, action_ir:actionIR, state:currentState, adapter_id:device.adapter_id },
  });
  return {
    ...currentState,
    gateway_trace: {
      action_id: actionIR?.id || null,
      outcome: actionIR ? ledger.get(actionIR.id)?.status : 'SUCCEEDED',
      action_ir: actionIR,
      compatibility_bridge: actionIR ? { legacy_capability:capability, legacy_args:args } : null,
      unified_action: { device: device.id, capability, args },
      adapter_id: device.adapter_id,
      native_trace: result?.native_trace,
      state_store_synced:true,
      event_recorded:true,
    },
  };
}

module.exports = { execute };
