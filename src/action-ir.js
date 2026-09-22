'use strict';
const crypto=require('crypto');
const { CAPABILITY_MODEL_VERSION, legacyToCapability, validateCapabilityAction, capabilityToLegacy }=require('./capability-model');
const ACTION_IR_VERSION='reality-action/1.0';

function buildActionIR({device,legacyCapability,args={},sourceText='',intent=null,planId=null,actor=null}) {
  if(!device) throw new Error('Action IR 대상 기기가 없습니다.');
  const mapped=legacyToCapability(device,legacyCapability,args);
  const cap=validateCapabilityAction(device,mapped.capability_id,mapped.operation,mapped.input);
  return {
    schema:ACTION_IR_VERSION,
    id:crypto.randomUUID(),
    target:{device_id:device.id,device_type:device.type},
    capability:{id:cap.id,kind:cap.kind,model_version:CAPABILITY_MODEL_VERSION},
    operation:mapped.operation,
    input:mapped.input,
    semantics:{risk:cap.risk,reversible:cap.reversible,idempotent:cap.idempotent,tags:[...cap.tags]},
    provenance:{source_text:String(sourceText||'').slice(0,500),intent:intent||null,plan_id:planId||null,actor_id:actor?.id||null},
    compatibility:{legacy_capability:legacyCapability,legacy_args:{...(args||{})}},
  };
}
function validateActionIR(ir,device){
  if(!ir||ir.schema!==ACTION_IR_VERSION) throw new Error('지원하지 않는 Typed Action IR입니다.');
  if(!device||ir.target?.device_id!==device.id) throw new Error('Action IR target과 실행 기기가 일치하지 않습니다.');
  const cap=validateCapabilityAction(device,ir.capability?.id,ir.operation,ir.input||{});
  return {ir,capability:cap};
}
function actionIRToLegacy(ir,device){ validateActionIR(ir,device); return capabilityToLegacy(device,ir.capability.id,ir.operation,ir.input||{}); }
function publicActionIRSpec(){return{version:ACTION_IR_VERSION,capability_model:CAPABILITY_MODEL_VERSION,flow:'Intent → Planner → Typed Action IR → Policy/Safety → Executor → compatibility bridge → Adapter',fields:{target:'device identity',capability:'semantic capability',operation:'read/write/invoke',input:'typed capability input',semantics:'risk/reversibility/idempotency',provenance:'source/intent/plan/actor',compatibility:'temporary legacy bridge for v1.x adapters'}};}
module.exports={ACTION_IR_VERSION,buildActionIR,validateActionIR,actionIRToLegacy,publicActionIRSpec};
