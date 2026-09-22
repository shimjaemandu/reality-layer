const { evaluatePolicy, publicPolicySpec } = require('./policy-engine');
const { getIdentity } = require('./identity');
const { getContext } = require('./context');
const { actionIRToLegacy } = require('./action-ir');

function evaluate(device, capability, args = {}, options = {}) {
  return evaluatePolicy({
    identity: options.identity || getIdentity(),
    device,
    capability,
    args,
    context: options.context || getContext(),
  });
}

function evaluateActionIR(device, actionIR, options = {}) {
  const legacy = actionIRToLegacy(actionIR, device);
  return evaluate(device, legacy.capability, legacy.args, options);
}

module.exports = { evaluate, evaluateActionIR, publicPolicySpec };
