const crypto = require('crypto');
const { devices } = require('./devices');
const { evaluateActionIR } = require('./permission');
const { buildUnifiedCommand } = require('./unified-command');
const { buildActionIR } = require('./action-ir');
const { graphSnapshotForDevice } = require('./device-graph');
const { actionContext, contextGraphSnapshotForAction } = require('./context-graph');

const ORCHESTRATOR_VERSION = 'reality-orchestrator/1.3';

const templates = {
  leave_home: {
    id:'leave_home',
    name:'외출 준비',
    match:[/나갈게/,/외출/,/집.*나가/,/밖에.*나가/],
    explanation:'외출 상황으로 이해했습니다. 재실자와 권한을 확인해 환경 정리 → 개인 기기 보호 → 출입 경계 잠금 순서로 계획합니다.',
    steps:[
      { id:'living_light_off', device:'living_room_light', capability:'turn_off', args:{}, title:'거실 조명 끄기', optional:true, skip_if_other_occupants:true, failure_policy:'continue' },
      { id:'bedroom_light_off', device:'bedroom_light', capability:'turn_off', args:{}, title:'침실 조명 끄기', optional:true, skip_if_other_occupants:true, failure_policy:'continue' },
      { id:'display_off', device:'room_display', capability:'turn_off', args:{}, title:'안내 디스플레이 끄기', optional:true, skip_if_other_occupants:true, failure_policy:'continue' },
      { id:'laptop_lock', device:'my_laptop', capability:'power_action', args:{ power_action:'lock' }, title:'개인 노트북 잠금', optional:true, failure_policy:'continue' },
      { id:'front_door_lock', device:'front_door', capability:'lock', args:{}, title:'현관문 잠금', optional:false, failure_policy:'stop' },
    ],
  },
  bedtime: {
    id:'bedtime',
    name:'취침 준비',
    match:[/잘게/,/자러/,/잘 거/,/취침/,/잠.*잘/],
    explanation:'취침 상황으로 이해했습니다. 다른 재실자를 방해하지 않는 범위에서 공용 환경을 정리하고 개인 기기를 보호합니다.',
    steps:[
      { id:'living_light_off', device:'living_room_light', capability:'turn_off', args:{}, title:'거실 조명 끄기', optional:true, skip_if_other_occupants:true, failure_policy:'continue' },
      { id:'display_off', device:'room_display', capability:'turn_off', args:{}, title:'안내 디스플레이 끄기', optional:true, skip_if_other_occupants:true, failure_policy:'continue' },
      { id:'bedroom_dim', device:'bedroom_light', capability:'set_brightness', args:{ brightness:20 }, title:'침실 조명 20%로 낮추기', optional:true, skip_if_other_occupants:true, failure_policy:'continue' },
      { id:'laptop_lock', device:'my_laptop', capability:'power_action', args:{ power_action:'lock' }, title:'개인 노트북 잠금', optional:true, failure_policy:'continue' },
    ],
  },
  study_mode: {
    id:'study_mode',
    name:'공부 준비',
    match:[/공부.*시작/,/공부할게/,/공부.*준비/],
    explanation:'공부 시작 상황으로 이해했습니다. 개인 공간 환경과 노트북 공부 도구를 순서대로 준비합니다.',
    steps:[
      { id:'bedroom_light_on', device:'bedroom_light', capability:'turn_on', args:{}, title:'침실 조명 켜기', optional:true, failure_policy:'continue' },
      { id:'bedroom_bright', device:'bedroom_light', capability:'set_brightness', args:{ brightness:80 }, title:'침실 조명 80%로 조절', optional:true, failure_policy:'continue' },
      { id:'study_workflow', device:'my_laptop', capability:'run_workflow', args:{ workflow:'study' }, title:'노트북 공부 도구 열기', optional:true, failure_policy:'continue' },
    ],
  },
};

function normalize(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g,' ');
}

function detectTemplate(text) {
  const normalized = normalize(text);
  if (!normalized) return null;
  return Object.values(templates).find((template)=>template.match.some((re)=>re.test(normalized))) || null;
}

function planDecision(steps) {
  const active = steps.filter((s)=>s.status !== 'skipped');
  const criticalBlocked = active.find((s)=>s.policy?.level === 'blocked' && !s.optional);
  if (criticalBlocked) return { level:'blocked', reason:`필수 단계 “${criticalBlocked.title}”가 정책에 의해 차단되었습니다.` };
  const confirm = active.find((s)=>s.policy?.level === 'confirm');
  if (confirm) return { level:'confirm', reason:'계획에 사용자 확인이 필요한 행동이 포함되어 있습니다.' };
  const executable = active.filter((s)=>s.policy?.allowed);
  if (!executable.length) return { level:'blocked', reason:'현재 Context와 권한에서 실행 가능한 단계가 없습니다.' };
  return { level:'auto', reason:'실행 가능한 모든 단계가 자동 실행 조건을 충족했습니다.' };
}

function evaluateStep(step, { identity, context, sourceText, planId=null }) {
  const device = devices[step.device];
  if (!device) return { ...step, status:'blocked', policy:{ allowed:false, level:'blocked', reason:'등록되지 않은 기기입니다.' } };

  const live = actionContext(device.id, identity.id);
  if (step.skip_if_other_occupants && (live?.other_occupants || []).length > 0) {
    return {
      ...step,
      status:'skipped',
      skip_reason:`영향 공간에 ${live.other_occupants.map((o)=>o.name).join(', ')}가 있어 자동으로 생략했습니다.`,
      context_graph:live,
    };
  }

  let actionIR;
  try {
    actionIR = buildActionIR({ device, legacyCapability:step.capability, args:step.args || {}, sourceText, intent:step.id, planId, actor:identity });
  } catch (error) {
    return { ...step, status:'blocked', policy:{ allowed:false, level:'blocked', reason:error.message } };
  }
  const policy = evaluateActionIR(device, actionIR, { identity, context });
  let unifiedCommand = null;
  if (policy.allowed) {
    try { unifiedCommand = buildUnifiedCommand(device, step.capability, step.args || {}, sourceText); }
    catch (error) {
      return { ...step, status:'blocked', action_ir:actionIR, policy:{ ...policy, allowed:false, level:'blocked', reason:error.message } };
    }
  }

  return {
    ...step,
    status: policy.allowed ? 'planned' : 'blocked',
    policy,
    action_ir: actionIR,
    unified_command: unifiedCommand,
    graph_snapshot: graphSnapshotForDevice(device.id),
    context_graph_snapshot: contextGraphSnapshotForAction(device.id, identity.id),
  };
}

function buildPlan(text, { identity, context }) {
  const template = detectTemplate(text);
  if (!template) {
    return {
      ok:false,
      reason:'v1.3 Orchestrator가 아직 이 복합 의도를 템플릿으로 지원하지 않습니다.',
      suggestion:'“나 이제 나갈게”, “나 잘게”, “공부 시작할게” 중 하나로 시험해보세요.',
      orchestrator_version:ORCHESTRATOR_VERSION,
    };
  }

  const planId = crypto.randomUUID();
  const steps = template.steps.map((step)=>evaluateStep(step, { identity, context, sourceText:text, planId }));
  const decision = planDecision(steps);
  return {
    ok: decision.level !== 'blocked',
    plan_id: planId,
    orchestrator_version:ORCHESTRATOR_VERSION,
    intent:template.id,
    title:template.name,
    source_text:String(text || '').slice(0,500),
    explanation:template.explanation,
    identity_snapshot:{ id:identity.id, role:identity.role },
    context_snapshot:{
      current_location:context.current_location,
      current_location_status:context.current_location_status,
      current_location_confidence:context.current_location_confidence,
    },
    decision:decision.level,
    reason:decision.reason,
    steps,
    summary:{
      total:steps.length,
      executable:steps.filter((s)=>s.status === 'planned' && s.policy?.allowed).length,
      skipped:steps.filter((s)=>s.status === 'skipped').length,
      blocked:steps.filter((s)=>s.policy?.level === 'blocked').length,
      confirm:steps.filter((s)=>s.policy?.level === 'confirm').length,
      critical_blocked:steps.filter((s)=>s.policy?.level === 'blocked' && !s.optional).length,
    },
  };
}

function publicOrchestratorSpec() {
  return {
    version:ORCHESTRATOR_VERSION,
    principle:'A high-level intent is decomposed into ordered device actions. Each action is independently checked by Context Graph, Device Graph, Permission and Safety before execution.',
    intents:Object.values(templates).map((t)=>({ id:t.id, name:t.name, step_count:t.steps.length })),
    decisions:['auto','confirm','blocked'],
    failure_policies:['continue','stop'],
  };
}

module.exports = { ORCHESTRATOR_VERSION, templates, detectTemplate, buildPlan, publicOrchestratorSpec, evaluateStep, planDecision };
