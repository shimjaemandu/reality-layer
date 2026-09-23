require('./src/runtime');
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { interpretWithAI, aiStatus } = require('./src/ai-intent');
const { devices, publicDevices, resetDeviceStates } = require('./src/devices');
const { evaluate, evaluateActionIR, publicPolicySpec } = require('./src/permission');
const { getIdentity, setIdentity, publicIdentities, resetIdentity } = require('./src/identity');
const { execute } = require('./src/executor');
const { publicPcRegistry } = require('./src/windows-pc');
const { registerUserApp, discoverApp } = require('./src/app-registry');
const { adapterSummary } = require('./src/adapters');
const { buildUnifiedCommand, publicInterfaceSpec } = require('./src/unified-command');
const { buildActionIR, publicActionIRSpec } = require('./src/action-ir');
const { publicCapabilityModel } = require('./src/capability-model');
const { getContext, setCurrentLocation, updateContextFromSensors, clearManualOverride, rememberAction, resetContext, publicContext } = require('./src/context');
const { applySensorEvent, resetSensors, publicSensors } = require('./src/sensors');
const { publicDeviceGraph, graphSnapshotForDevice, validateGraphSnapshot } = require('./src/device-graph');
const { publicRealityGraph } = require('./src/reality-graph');
const { publicStateStore, syncSensorState, resetStateStore } = require('./src/state-store');
const { appendEvent, readEvents, resetEventStore, publicEventStore } = require('./src/event-store');
const actionLedger = require('./src/action-ledger');
const recoveredInterruptedActions = actionLedger.recoverInterrupted();
const { getContextGraphState, publicContextGraph, setActorPresence, syncIdentityFromContext, resetContextGraph, contextGraphSnapshotForAction, validateContextGraphSnapshot } = require('./src/context-graph');
const { buildPlan, publicOrchestratorSpec } = require('./src/orchestrator');
const localAccess = require('./src/local-access');
const everyday = require('./src/everyday-store');
const { buildEverydayPlan, ROUTINES, executionMode } = require('./src/everyday-planner');
const { runtimeStatus } = require('./src/runtime');
const homeAssistant = require('./src/adapters/home-assistant-light');
const mcpAccess = require('./src/mcp-access');
const { createMcpServer, publicMcpSpec } = require('./src/mcp-server');
homeAssistant.setup(devices);
let mutating = false;
async function refreshConnected() {
  for (const d of Object.values(devices)) if (d.adapter_id === 'home_assistant_light') {
    try { await homeAssistant.refresh(d); } catch { /* Unavailable state is shown and execution will fail closed. */ }
  }
}


const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');
const LOG_FILE = path.join(ROOT, 'data', 'logs.json');
const pending = new Map();
const pendingPlans = new Map();

if (!fs.existsSync(LOG_FILE)) fs.writeFileSync(LOG_FILE, '[]\n');

function readLogs() { try { return JSON.parse(fs.readFileSync(LOG_FILE, 'utf8')); } catch { return []; } }
function saveLogs(logs) { fs.writeFileSync(LOG_FILE, JSON.stringify(logs.slice(-200), null, 2) + '\n'); }
function addLog(entry) { const logs = readLogs(); logs.push({ id: crypto.randomUUID(), at: new Date().toISOString(), ...entry }); saveLogs(logs); }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function readBody(req) {
  return new Promise((resolve,reject)=>{
    let body='',size=0,failed=false;
    req.on('data',chunk=>{size+=chunk.length;if(size>65536){failed=true;reject(new Error('요청은 64KB 이하여야 합니다.'));}else body+=chunk;});
    req.on('end',()=>{if(failed)return;try{const value=JSON.parse(body||'{}');if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();resolve(value);}catch{reject(new Error('JSON 객체가 필요합니다.'));}});
    req.on('error',reject);
    req.on('aborted',()=>reject(new Error('요청 연결이 끊겼습니다.')));
  });
}

function refreshContext(lastSensorId = null) {
  const context = updateContextFromSensors(publicSensors(), lastSensorId);
  syncIdentityFromContext(getIdentity(), context);
  return context;
}


async function handleInterpret(body, res) {
  refreshContext();
  const context = getContext();
  const result = await interpretWithAI(body.text, { context });
  if (!result.ok) return json(res, 200, { ...result, context: publicContext() });

  const device = devices[result.action.device];
  const identity = getIdentity();
  let actionIR;
  try {
    actionIR = buildActionIR({ device, legacyCapability:result.action.capability, args:result.action.args, sourceText:result.action.source_text, intent:'direct_command', actor:identity });
  } catch (error) {
    return json(res, 200, { ok:false, reason:error.message, action:result.action, context:publicContext() });
  }
  const permission = evaluateActionIR(device, actionIR, { identity, context });
  if (!permission.allowed) return json(res, 200, {
    ok: false,
    reason: permission.reason,
    action: result.action,
    action_ir: actionIR,
    permission,
    policy: permission,
    identity,
    engine: result.engine,
    model: result.model,
    warning: result.warning,
    context: publicContext(),
  });

  let unifiedCommand;
  try {
    unifiedCommand = buildUnifiedCommand(device, result.action.capability, result.action.args, result.action.source_text);
  } catch (error) {
    return json(res, 200, { ok:false, reason:error.message, context:publicContext() });
  }

  const contextUsed = result.context_used || [];
  const requestId = crypto.randomUUID();
  pending.set(requestId, {
    action: result.action,
    action_ir: actionIR,
    unified_command: unifiedCommand,
    permission,
    policy: permission,
    identity_snapshot: { id: identity.id, role: identity.role },
    context_used: contextUsed,
    context_snapshot: {
      current_location: context.current_location,
      current_location_status: context.current_location_status,
      current_location_confidence: context.current_location_confidence,
      last_device: context.last_device,
    },
    graph_snapshot: graphSnapshotForDevice(device.id),
    context_graph_snapshot: contextGraphSnapshotForAction(device.id, identity.id),
    createdAt: Date.now(),
  });
  setTimeout(() => pending.delete(requestId), 5 * 60 * 1000).unref();
  return json(res, 200, {
    ok: true,
    request_id: requestId,
    confidence: result.confidence,
    explanation: result.explanation,
    context_used: contextUsed,
    action: result.action,
    action_ir: actionIR,
    unified_command: unifiedCommand,
    permission,
    policy: permission,
    identity,
    engine: result.engine,
    model: result.model,
    warning: result.warning,
    context: publicContext(),
    device: device ? { id: device.id, name: device.name, type: device.type, state: { ...device.state } } : null,
  });
}

function validateContextStillFresh(item) {
  refreshContext();
  const now = getContext();
  if (item.context_used.includes('current_location')) {
    const before = item.context_snapshot;
    const stable = now.current_location && now.current_location === before.current_location && ['resolved', 'manual'].includes(now.current_location_status) && now.current_location_confidence >= 0.6;
    if (!stable) return { ok: false, reason: '명령을 해석한 뒤 현재 위치 Context가 바뀌거나 불확실해졌습니다. 안전을 위해 다시 해석해야 합니다.', context: now };
  }
  if (item.context_used.includes('last_device') && now.last_device !== item.context_snapshot.last_device) {
    return { ok: false, reason: '최근 기기 Context가 바뀌었습니다. 안전을 위해 다시 해석해야 합니다.', context: now };
  }
  return { ok: true, context: now };
}

async function handleExecute(body, res) {
  await refreshConnected();
  const item = pending.get(body.request_id);
  if (!item) return json(res, 400, { ok: false, error: '명령이 만료되었거나 존재하지 않습니다.' });

  const contextCheck = validateContextStillFresh(item);
  if (!contextCheck.ok) {
    pending.delete(body.request_id);
    return json(res, 409, { ok: false, context_changed: true, error: contextCheck.reason, context: publicContext() });
  }

  const currentIdentity = getIdentity();
  if (!item.identity_snapshot || currentIdentity.id !== item.identity_snapshot.id || currentIdentity.role !== item.identity_snapshot.role) {
    pending.delete(body.request_id);
    return json(res, 409, { ok:false, identity_changed:true, error:'명령을 해석한 뒤 Identity가 변경되었습니다. 다시 해석해야 합니다.', identity:currentIdentity });
  }

  const { action } = item;
  const device = devices[action.device];
  if (!validateGraphSnapshot(item.graph_snapshot)) {
    pending.delete(body.request_id);
    return json(res, 409, { ok:false, graph_changed:true, error:'명령을 해석한 뒤 Device Graph 관계가 변경되었습니다. 다시 해석해야 합니다.' });
  }
  if (!validateContextGraphSnapshot(item.context_graph_snapshot)) {
    pending.delete(body.request_id);
    return json(res, 409, { ok:false, context_graph_changed:true, error:'명령을 해석한 뒤 사람 위치·재실·기기 상태 같은 Context Graph가 변경되었습니다. 다시 해석해야 합니다.' });
  }
  const freshPermission = evaluateActionIR(device, item.action_ir, { identity: currentIdentity, context: getContext() });
  if (!freshPermission.allowed) return json(res, 403, { ok: false, error: freshPermission.reason });
  if (freshPermission.level === 'confirm' && body.confirmed !== true) return json(res, 409, { ok: false, needs_confirmation: true, reason: freshPermission.reason });

  try {
    pending.delete(body.request_id);
    const state = await execute(device, item.action_ir);
    const context = rememberAction(device.id, action.capability);
    addLog({ source_text: action.source_text, actor: currentIdentity, device: device.id, device_name: device.name, capability: action.capability, args: action.args, action_ir:item.action_ir, unified_command: item.unified_command, graph_snapshot:item.graph_snapshot, context_graph_snapshot:item.context_graph_snapshot, graph_context:freshPermission.graph_context, context_graph:freshPermission.context_graph, policy_decision: freshPermission, result: 'executed', state, context_used: item.context_used, context_after: context });
    pending.delete(body.request_id);
    return json(res, 200, { ok: true, device: { id: device.id, name: device.name, state }, context: publicContext() });
  } catch (error) {
    addLog({ source_text: action.source_text, device: device?.id, capability: action.capability, result: 'error', error: error.message });
    return json(res, 400, { ok: false, error: error.message });
  }
}


function storeOrchestrationPlan(plan) {
  pendingPlans.set(plan.plan_id, plan);
  setTimeout(() => pendingPlans.delete(plan.plan_id), 5 * 60 * 1000).unref();
}

function validatePlanFresh(plan) {
  refreshContext();
  const identity = getIdentity();
  if (plan.everyday && (Date.now() > plan.expires_at || plan.store_revision !== everyday.snapshot().revision || plan.context_snapshot.current_location !== getContext().current_location)) return {ok:false, reason:'개인 설정·활동·현재 공간이 변경되었거나 계획이 만료되었습니다.'};
  if (plan.everyday && plan.session_effect==='resume' && everyday.snapshot().session?.status==='completed') return {ok:false,reason:'이어가려던 활동의 집중 시간이 이미 끝났습니다.'};
  if (!plan.identity_snapshot || identity.id !== plan.identity_snapshot.id || identity.role !== plan.identity_snapshot.role) {
    return { ok:false, reason:'계획을 만든 뒤 Identity가 변경되었습니다.' };
  }
  for (const step of plan.steps) {
    if (step.status === 'skipped') continue;
    if (step.graph_snapshot && !validateGraphSnapshot(step.graph_snapshot)) {
      return { ok:false, reason:`“${step.title}” 단계의 Device Graph 관계가 변경되었습니다.` };
    }
    if (step.context_graph_snapshot && !validateContextGraphSnapshot(step.context_graph_snapshot)) {
      return { ok:false, reason:`“${step.title}” 단계와 관련된 사람 위치·재실·기기 상태가 변경되었습니다.` };
    }
  }
  return { ok:true };
}

async function createNorthboundPlan(body = {}) {
  refreshContext();
  const identity = getIdentity();
  const context = getContext();
  const text = String(body.text || '').trim().slice(0,500);
  if (!text) return { ok:false, reason:'계획할 자연어 text가 필요합니다.', identity, context:publicContext() };

  // High-level intents keep using the existing Orchestrator first.
  let plan = buildPlan(text, { identity, context });
  if (!plan.ok) {
    // Northbound MCP must also handle safe single-device commands, not only v1.3 templates.
    const interpreted = await interpretWithAI(text, { context });
    if (!interpreted.ok) return { ...interpreted, identity, context:publicContext(), source:'northbound-direct-plan' };
    const device = devices[interpreted.action.device];
    if (!device) return { ok:false, reason:'해석된 대상 기기가 등록되어 있지 않습니다.', identity, context:publicContext() };
    let actionIR, unifiedCommand;
    const planId = crypto.randomUUID();
    try {
      actionIR = buildActionIR({
        device,
        legacyCapability:interpreted.action.capability,
        args:interpreted.action.args || {},
        sourceText:text,
        intent:'direct_command',
        planId,
        actor:identity,
      });
      unifiedCommand = buildUnifiedCommand(device, interpreted.action.capability, interpreted.action.args || {}, text);
    } catch (error) {
      return { ok:false, reason:error.message, identity, context:publicContext() };
    }
    const policy = evaluateActionIR(device, actionIR, { identity, context });
    const step = {
      id:'direct_action', title:`${device.name}: ${interpreted.action.capability}`,
      device:device.id, capability:interpreted.action.capability, args:interpreted.action.args || {},
      optional:false, failure_policy:'stop',
      status:policy.allowed ? 'planned' : 'blocked',
      policy, action_ir:actionIR, unified_command:unifiedCommand,
      graph_snapshot:graphSnapshotForDevice(device.id),
      context_graph_snapshot:contextGraphSnapshotForAction(device.id, identity.id),
    };
    plan = {
      ok:policy.allowed,
      plan_id:planId,
      orchestrator_version:'reality-northbound/1.8.2',
      intent:'direct_command',
      title:'직접 Reality 행동',
      source_text:text,
      explanation:interpreted.explanation || '자연어를 단일 Typed Action IR 계획으로 컴파일했습니다.',
      identity_snapshot:{id:identity.id,role:identity.role},
      context_snapshot:{
        current_location:context.current_location,
        current_location_status:context.current_location_status,
        current_location_confidence:context.current_location_confidence,
      },
      decision:policy.allowed ? policy.level : 'blocked',
      reason:policy.reason,
      steps:[step],
      summary:{ total:1, executable:policy.allowed?1:0, skipped:0, blocked:policy.allowed?0:1, confirm:policy.level==='confirm'?1:0, critical_blocked:policy.allowed?0:1 },
      engine:interpreted.engine,
      model:interpreted.model,
    };
  }
  if (plan.ok) storeOrchestrationPlan(plan);
  return { ...plan, identity, context:publicContext() };
}

function handleOrchestratePlan(body, res) {
  refreshContext();
  const identity = getIdentity();
  const context = getContext();
  const plan = buildPlan(body.text, { identity, context });
  if (!plan.ok) return json(res, 200, { ...plan, identity, context:publicContext() });
  storeOrchestrationPlan(plan);
  return json(res, 200, { ...plan, identity, context:publicContext() });
}

function actionContractFromState(state) {
  const trace = state?.gateway_trace;
  const actionId = trace?.action_id;
  if (!actionId) return null;
  const saved = actionLedger.get(actionId);
  const outcome = saved?.status || trace?.outcome || null;
  return {
    schema:'reality-action-result/1.0',
    action_id:actionId,
    outcome,
    provenance:saved?.provenance || trace?.action_ir?.provenance || {},
    evidence:saved?.evidence || [],
    reconciliation:{
      required:outcome === 'UNKNOWN',
      state:outcome === 'UNKNOWN' ? 'REQUIRED' : 'NOT_REQUIRED',
      rule:'Do not blindly retry UNKNOWN. Reconcile from trustworthy external evidence first.',
    },
  };
}

async function executeOrchestrationPlan(body = {}, { externalAgent=false } = {}) {
  await refreshConnected();
  const plan = pendingPlans.get(body.plan_id);
  if (!plan) return { status:400, body:{ ok:false, error:'Orchestration 계획이 만료되었거나 존재하지 않습니다.' } };

  const fresh = validatePlanFresh(plan);
  if (!fresh.ok) {
    pendingPlans.delete(body.plan_id);
    return { status:409, body:{ ok:false, plan_stale:true, error:`현실 상태가 바뀌었습니다. ${fresh.reason} 안전을 위해 계획을 다시 만들어야 합니다.` } };
  }
  if (plan.decision === 'confirm') {
    if (externalAgent) return { status:409, body:{ ok:false, needs_user_confirmation:true, decision:'confirm', plan_id:plan.plan_id, reason:'외부 MCP Agent는 사용자 확인을 스스로 승인할 수 없습니다. 신뢰된 로컬 UI에서 사용자가 직접 확인해야 합니다.', policy_reason:plan.reason } };
    if (body.confirmed !== true) return { status:409, body:{ ok:false, needs_confirmation:true, reason:plan.reason } };
  }
  if (plan.decision === 'blocked') {
    pendingPlans.delete(body.plan_id);
    return { status:403, body:{ ok:false, error:plan.reason } };
  }

  // Consume before the first async device request; retries must not repeat a partially executed plan.
  pendingPlans.delete(body.plan_id);
  const identity = getIdentity();
  const results = [];
  let stopped = false;
  let stopReason = null;

  for (let index = 0; index < plan.steps.length; index += 1) {
    const step = plan.steps[index];
    if (step.status === 'skipped') {
      results.push({ step_id:step.id, title:step.title, status:'skipped', reason:step.skip_reason });
      continue;
    }

    const device = devices[step.device];
    const freshPolicy = step.action_ir ? evaluateActionIR(device, step.action_ir, { identity, context:getContext() }) : evaluate(device, step.capability, step.args || {}, { identity, context:getContext() });
    if (!freshPolicy.allowed) {
      const result = { step_id:step.id, title:step.title, status:'blocked', reason:freshPolicy.reason, critical:!step.optional };
      results.push(result);
      if (!step.optional || step.failure_policy === 'stop') { stopped = true; stopReason = freshPolicy.reason; break; }
      continue;
    }
    if (freshPolicy.level === 'confirm') {
      if (externalAgent) {
        storeOrchestrationPlan(plan);
        return { status:409, body:{ ok:false, needs_user_confirmation:true, decision:'confirm', plan_id:plan.plan_id, reason:`“${step.title}” 단계에 사용자 확인이 필요하며 외부 Agent는 이를 스스로 승인할 수 없습니다.`, policy_reason:freshPolicy.reason } };
      }
      if (body.confirmed !== true) {
        storeOrchestrationPlan(plan);
        return { status:409, body:{ ok:false, needs_confirmation:true, reason:`“${step.title}” 단계에 사용자 확인이 필요합니다.` } };
      }
    }

    try {
      const state = await execute(device, step.action_ir || step.capability, step.args || {});
      rememberAction(device.id, step.capability);
      const action = actionContractFromState(state);
      const result = { step_id:step.id, title:step.title, status:'executed', device:device.id, capability:step.capability, action, state, policy:freshPolicy };
      results.push(result);
      addLog({
        source_text:plan.source_text,
        orchestration:{ plan_id:plan.plan_id, intent:plan.intent, title:plan.title, step_index:index, step_id:step.id },
        actor:identity,
        device:device.id,
        device_name:device.name,
        capability:step.capability,
        args:step.args || {},
        action_ir:step.action_ir || null,
        unified_command:step.unified_command,
        policy_decision:freshPolicy,
        result:'executed',
        state,
      });
    } catch (error) {
      results.push({ step_id:step.id, title:step.title, status:'error', reason:error.message, critical:!step.optional });
      addLog({ source_text:plan.source_text, orchestration:{ plan_id:plan.plan_id, step_id:step.id }, device:device?.id, capability:step.capability, result:'error', error:error.message });
      if (!step.optional || step.failure_policy === 'stop') { stopped = true; stopReason = error.message; break; }
    }
  }

  pendingPlans.delete(body.plan_id);
  const executed = results.filter((r)=>r.status === 'executed').length;
  const skipped = results.filter((r)=>r.status === 'skipped').length;
  const failed = results.filter((r)=>['blocked','error'].includes(r.status)).length;
  if (plan.everyday && executed > 0 && !stopped && failed === 0) everyday.commit(plan.session_effect, plan.context_snapshot.current_location);
  const partial = failed > 0 || (executed === 0 && plan.steps.length > 0);
  const actions = results.map((r)=>r.action).filter(Boolean);
  const reconciliationRequired = actions.some((action)=>action.outcome === 'UNKNOWN');
  return { status:stopped ? 409 : 200, body:{
    ok:!stopped,
    plan_id:plan.plan_id,
    intent:plan.intent,
    title:plan.title,
    status:stopped ? 'stopped' : partial ? 'partial' : 'completed',
    partial,
    everyday:plan.everyday ? everyday.snapshot() : undefined,
    stop_reason:stopReason,
    summary:{ executed, skipped, failed, total:plan.steps.length },
    action:actions.length === 1 ? actions[0] : undefined,
    actions,
    reconciliation_required:reconciliationRequired,
    results,
    context:publicContext(),
  } };
}

async function handleOrchestrateExecute(body, res) {
  const result = await executeOrchestrationPlan(body, { externalAgent:false });
  return json(res, result.status, result.body);
}

function northboundDiscover(args = {}) {
  refreshContext();
  const includeGraph = args.include_graph !== false;
  return {
    ok:true,
    reality_layer_version:'1.8.2',
    identity:getIdentity(),
    runtime:runtimeStatus(),
    capability_model:publicCapabilityModel(),
    devices:publicDevices().map((device)=>({ id:device.id, name:device.name, type:device.type, location:device.location, capability_model:device.capability_model })),
    policy:publicPolicySpec(),
    graph:includeGraph ? publicRealityGraph() : undefined,
    northbound:publicMcpSpec(),
  };
}

function northboundObserve(args = {}) {
  refreshContext();
  const state = publicStateStore();
  const deviceId = args.device_id ? String(args.device_id) : null;
  if (deviceId && !devices[deviceId]) return { ok:false, error:'등록되지 않은 device_id입니다.' };
  const eventLimit = Number.isInteger(args.event_limit) ? args.event_limit : 10;
  const filteredState = deviceId ? { ...state, devices:{ [deviceId]:state.devices[deviceId] } } : state;
  const events = readEvents({limit:eventLimit,reverse:true}).filter((event)=>!deviceId || event.target_id === deviceId);
  return {
    ok:true,
    identity:getIdentity(),
    state_store:filteredState,
    context:args.include_context === false ? undefined : publicContext(),
    context_graph:args.include_context === false ? undefined : publicContextGraph(),
    recent_events:events.slice(0,eventLimit),
  };
}

async function northboundExecute(args = {}) {
  const plan = pendingPlans.get(args.plan_id);
  if (!plan) return { ok:false, error:'계획이 만료되었거나 존재하지 않습니다.', plan_id:args.plan_id };
  const result = await executeOrchestrationPlan({ plan_id:args.plan_id }, { externalAgent:true });
  return { ...result.body, http_status:result.status };
}

function northboundActionGet(args = {}) {
  const action = actionLedger.get(String(args.action_id || ''));
  if (!action) return { ok:false, error:'해당 action_id를 찾지 못했습니다.', action_id:args.action_id || null };
  return {
    ok:true,
    action,
    reconciliation:{
      required:action.status === 'UNKNOWN',
      state:action.status === 'UNKNOWN' ? 'REQUIRED' : 'NOT_REQUIRED',
      rule:'Do not blindly retry UNKNOWN. Reconcile from trustworthy external evidence first.',
    },
  };
}

function northboundActionReconcile(args = {}, {client} = {}) {
  const actionId = String(args.action_id || '');
  const before = actionLedger.get(actionId);
  if (!before) return { ok:false, error:'해당 action_id를 찾지 못했습니다.', action_id:actionId };
  if (before.status !== 'UNKNOWN') {
    return { ok:true, action:before, changed:false, note:'이미 UNKNOWN이 아닌 상태이므로 결과를 변경하지 않았습니다.', reconciliation:{required:false,state:'NOT_REQUIRED'} };
  }
  const action = actionLedger.reconcile(actionId,{
    outcome:String(args.outcome || ''),
    evidence:{ source:'mcp-reconciliation', note:String(args.evidence_note || '').slice(0,500), client:client || null },
  });
  appendEvent({
    type:'action.outcome.reconciled', source:'mcp-reconciliation', actor_id:getIdentity()?.id || null, target_id:actionId,
    payload:{ action_id:actionId, outcome:action.status, client:client || null, evidence_note:String(args.evidence_note || '').slice(0,500) },
  });
  return { ok:true, action, changed:true, reconciliation:{required:false,state:'RESOLVED'} };
}

function northboundExplain(args = {}) {
  const limit = Number.isInteger(args.limit) ? Math.max(1,Math.min(20,args.limit)) : 10;
  const planId = args.plan_id ? String(args.plan_id) : null;
  const pendingPlan = planId ? pendingPlans.get(planId) : null;
  const logs = readLogs().slice().reverse().filter((entry)=>!planId || entry.orchestration?.plan_id === planId).slice(0,limit);
  const events = readEvents({limit:100,reverse:true}).filter((event)=>{
    if (!planId) return ['mcp.tool.called','mcp.tool.result','device.action.executed'].includes(event.type);
    return event.target_id === planId || event.payload?.plan_id === planId || event.payload?.action_ir?.provenance?.plan_id === planId;
  }).slice(0,limit);
  if (planId && !pendingPlan && logs.length === 0 && events.length === 0) return { ok:false, error:'해당 plan_id의 대기 계획 또는 실행 기록을 찾지 못했습니다.', plan_id:planId };
  return {
    ok:true,
    plan_id:planId,
    pending_plan:pendingPlan ? {
      title:pendingPlan.title, intent:pendingPlan.intent, decision:pendingPlan.decision, reason:pendingPlan.reason,
      steps:pendingPlan.steps.map((step)=>({ id:step.id,title:step.title,status:step.status,device:step.device,capability:step.capability,policy:step.policy })),
    } : null,
    execution_logs:logs,
    audit_events:events,
    explanation:pendingPlan ? `현재 계획 결정은 ${pendingPlan.decision}입니다. 각 단계의 Policy/Safety 결과를 함께 반환했습니다.` : '저장된 실행 로그와 Event Store 감사 기록을 기준으로 설명합니다.',
  };
}

const mcpServer = createMcpServer({
  currentIdentity:getIdentity,
  discover:northboundDiscover,
  observe:northboundObserve,
  plan:async (args)=>createNorthboundPlan(args),
  execute:northboundExecute,
  explain:northboundExplain,
  actionGet:northboundActionGet,
  actionReconcile:northboundActionReconcile,
});

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safePath = path.normalize(urlPath).replace(/^([.][.][/\\])+/, '');
  const filePath = path.join(PUBLIC, safePath);
  if (!filePath.startsWith(PUBLIC)) return false;
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) return false;
  const ext = path.extname(filePath).toLowerCase();
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  let ownsMutation=false;
  try {
    const accessError=localAccess.check(req, server.address()?.port || PORT);
    if (accessError) return json(res,403,{ok:false,error:accessError});
    if (!['GET','HEAD'].includes(req.method)) {
      if (mutating) return json(res,423,{ok:false,error:'다른 요청을 처리 중이에요. 완료 후 다시 시도해 주세요.'});
      mutating=true;ownsMutation=true;
    }
    if (req.method==='GET' && req.url==='/api/session') return json(res,200,{ok:true,token:localAccess.token});
    if (req.method==='GET' && req.url==='/api/mcp-status') return json(res,200,{ok:true,mcp:publicMcpSpec(),access:mcpAccess.publicStatus(server.address()?.port || PORT)});
    if (req.url==='/mcp' && req.method==='POST') return await mcpServer.handle(req,res,await readBody(req));
    if (req.url==='/mcp' && req.method==='DELETE') return await mcpServer.handle(req,res,{});
    if (req.method==='GET' && req.url==='/api/everyday') {
      refreshContext();
      return json(res,200,{ok:true,version:'1.8.2',...everyday.snapshot(),context:publicContext(),identity:getIdentity(),runtime:runtimeStatus(),ai:aiStatus(),bridge:homeAssistant.status(),routines:ROUTINES.map(({re,...r})=>r),devices:publicDevices().filter(d=>d.type!=='door').map(d=>({...d,execution_mode:executionMode(d)})),actor_presence:getContextGraphState().actors,logs:readLogs().slice(-25).reverse()});
    }
    if (req.method==='POST' && req.url==='/api/everyday/profile') {
      if (getIdentity().role!=='owner') return json(res,403,{ok:false,error:'개인 설정은 소유자 역할에서 변경해 주세요.'});
      return json(res,200,{ok:true,...everyday.updateProfile(await readBody(req))});
    }
    if (req.method==='POST' && req.url==='/api/everyday/session') {
      if(getIdentity().role!=='owner')return json(res,403,{ok:false,error:'개인 활동은 소유자 역할에서 변경해 주세요.'});
      return json(res,200,{ok:true,...everyday.sessionControl((await readBody(req)).action)});
    }
    if (req.method==='POST' && req.url==='/api/everyday/plan') {
      const body=await readBody(req);
      await refreshConnected();refreshContext();
      const plan=await buildEverydayPlan(body.text,{identity:getIdentity(),context:getContext()});
      if (plan.ok) storeOrchestrationPlan(plan);
      return json(res,200,plan);
    }
    if (req.method==='POST' && req.url==='/api/everyday/execute') return await handleOrchestrateExecute(await readBody(req),res);
    if (req.method==='POST' && req.url==='/api/everyday/cancel') {const body=await readBody(req);pendingPlans.delete(body.plan_id);return json(res,200,{ok:true});}
    if (req.method==='POST' && req.url==='/api/everyday/refresh') {await refreshConnected();return json(res,200,{ok:true});}

    if (req.method === 'GET' && req.url.startsWith('/api/state-store')) return json(res, 200, { ok:true, state_store:publicStateStore() });
    if (req.method === 'GET' && req.url.startsWith('/api/state')) return json(res, 200, { ok: true, devices: publicDevices() });
    if (req.method === 'GET' && req.url.startsWith('/api/pc-registry')) return json(res, 200, { ok:true, ...publicPcRegistry() });
    if (req.method === 'POST' && req.url === '/api/apps/register') {
      if (getIdentity().role!=='owner') return json(res,403,{ok:false,error:'앱 경로 등록은 소유자 역할에서만 할 수 있어요.'});
      const body=await readBody(req);
      const app=registerUserApp(body);
      return json(res,200,{ok:true,app,registry:publicPcRegistry()});
    }
    if (req.method === 'POST' && req.url === '/api/apps/discover') {
      if (getIdentity().role!=='owner') return json(res,403,{ok:false,error:'앱 자동 탐색은 소유자 역할에서만 사용할 수 있어요.'});
      const body=await readBody(req);
      const found=discoverApp(String(body.id||'').trim().toLowerCase());
      if (!found) return json(res,404,{ok:false,error:'Windows에서 해당 앱을 자동으로 찾지 못했습니다. 설치 상태를 확인해 주세요.'});
      return json(res,200,{ok:true,app:{id:found.id,name:found.name,launch_method:found.launch_method,discovered_by:found.discovered_by,start_app_name:found.start_app_name||null,executable:found.executable||null},registry:publicPcRegistry()});
    }
    if (req.method === 'GET' && req.url.startsWith('/api/device-registry')) return json(res, 200, { ok:true, action_ir:publicActionIRSpec(), capability_model:publicCapabilityModel(), interface: publicInterfaceSpec(), adapters: adapterSummary(), devices: publicDevices() });
    if (req.method === 'GET' && req.url.startsWith('/api/capability-model')) return json(res, 200, { ok:true, capability_model:publicCapabilityModel() });
    if (req.method === 'GET' && req.url.startsWith('/api/action-ir')) return json(res, 200, { ok:true, action_ir:publicActionIRSpec() });
    if (req.method === 'GET' && req.url.startsWith('/api/device-graph')) return json(res, 200, { ok:true, graph:publicDeviceGraph(), compatibility:true });
    if (req.method === 'GET' && req.url.startsWith('/api/reality-graph')) return json(res, 200, { ok:true, graph:publicRealityGraph() });
    if (req.method === 'GET' && req.url.startsWith('/api/event-store')) return json(res, 200, { ok:true, event_store:publicEventStore({limit:100,reverse:true}) });
    if (req.method === 'GET' && req.url.startsWith('/api/actions')) { const id=new URL(req.url,'http://local').searchParams.get('id'); return json(res,200,{ok:true, action:id?actionLedger.get(id):undefined, actions:id?undefined:actionLedger.list(100)}); }
    if (req.method === 'POST' && req.url === '/api/actions/reconcile') { const body=await readBody(req); const action=actionLedger.reconcile(body.action_id,{outcome:body.outcome,evidence:body.evidence||{}}); appendEvent({type:'action.outcome.reconciled',source:'reconciliation',target_id:body.action_id,payload:{action_id:body.action_id,outcome:action.status}}); return json(res,200,{ok:true,action}); }
    if (req.method === 'GET' && req.url.startsWith('/api/context-graph')) return json(res, 200, { ok:true, graph:publicContextGraph(), compatibility_projection:true });
    if (req.method === 'POST' && req.url === '/api/context-graph/actor') {
      const body = await readBody(req);
      const actor = setActorPresence(body.actor_id, { present:body.present, location:body.location, source:'simulation', confidence:1 });
      return json(res, 200, { ok:true, actor, graph:publicContextGraph(), note:'대기 중 명령은 자동 삭제하지 않습니다. 실행 시 Context Graph snapshot 검증으로 stale action을 차단합니다.' });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/reality-policy')) return json(res, 200, { ok:true, policy:publicPolicySpec(), identity:getIdentity(), identities:publicIdentities() });
    if (req.method === 'POST' && req.url === '/api/identity') {
      const body = await readBody(req);
      const identity = setIdentity(body.identity_id);
      syncIdentityFromContext(identity, getContext());
      pending.clear();
      return json(res, 200, { ok:true, identity, identities:publicIdentities(), note:'Identity 변경으로 대기 중이던 명령을 폐기했습니다.' });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/context')) { refreshContext(); return json(res, 200, { ok: true, context: publicContext() }); }
    if (req.method === 'GET' && req.url.startsWith('/api/sensors')) return json(res, 200, { ok: true, sensors: publicSensors() });
    if (req.method === 'GET' && req.url.startsWith('/api/sensor-events')) return json(res, 200, { ok: true, events: readEvents({type:'sensor.observation',limit:200,reverse:true}) });
    if (req.method === 'POST' && req.url === '/api/sensor-event') {
      const body = await readBody(req);
      const event = applySensorEvent(body.sensor_id, body.detected);
      syncSensorState(event.id, event.state, 'sensor');
      const context = refreshContext(event.id);
      appendEvent({ type:'sensor.observation', source:'sensor', target_id:event.id, payload:{ sensor_id:event.id, sensor_name:event.name, sensor_type:event.type, location:event.location, detected:event.state.detected, reliability:event.reliability, context_after:context } });
      return json(res, 200, { ok: true, sensor: event, context: publicContext(), sensors: publicSensors() });
    }
    if (req.method === 'POST' && req.url === '/api/context') {
      const body = await readBody(req);
      const context = setCurrentLocation(body.current_location);
      syncIdentityFromContext(getIdentity(), context);
      return json(res, 200, { ok: true, context: publicContext(), context_graph:publicContextGraph() });
    }
    if (req.method === 'POST' && req.url === '/api/context/auto') {
      const context = clearManualOverride(publicSensors());
      syncIdentityFromContext(getIdentity(), context);
      return json(res, 200, { ok: true, context: publicContext(), context_graph:publicContextGraph() });
    }
    if (req.method === 'GET' && req.url.startsWith('/api/orchestrator')) return json(res, 200, { ok:true, orchestrator:publicOrchestratorSpec(), pending_plans:pendingPlans.size });
    if (req.method === 'POST' && req.url === '/api/orchestrate-plan') return handleOrchestratePlan(await readBody(req), res);
    if (req.method === 'POST' && req.url === '/api/orchestrate-execute') return await handleOrchestrateExecute(await readBody(req), res);
    if (req.method === 'GET' && req.url.startsWith('/api/logs')) return json(res, 200, { ok: true, logs: readLogs().slice().reverse() });
    if (req.method === 'GET' && req.url.startsWith('/api/ai-status')) return json(res, 200, { ok: true, ...aiStatus() });
    if (req.method === 'POST' && req.url === '/api/interpret') return await handleInterpret(await readBody(req), res);
    if (req.method === 'POST' && req.url === '/api/execute') return await handleExecute(await readBody(req), res);
    if (req.method === 'POST' && req.url === '/api/reset') {
      if(runtimeStatus().live)return json(res,403,{ok:false,error:'실제 연결 모드에서는 기기 상태를 초기화할 수 없습니다.'});
      resetDeviceStates();
      saveLogs([]); pending.clear(); pendingPlans.clear(); resetSensors(); resetContext(); resetIdentity(); resetStateStore(); resetEventStore(); actionLedger.reset(); resetContextGraph();
      return json(res, 200, { ok: true });
    }
    if (req.method === 'GET' && serveStatic(req, res)) return;
    json(res, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    json(res, 400, { ok: false, error: error.message });
  } finally { if (ownsMutation) mutating=false; }
});

if (require.main === module) {
  server.listen(PORT, '127.0.0.1', () => {
    const status = aiStatus();
    console.log(`Reality Layer v1.8.2 — External Runtime → http://127.0.0.1:${PORT}`);
    if (recoveredInterruptedActions.length) console.warn(`[Reality Layer] recovered ${recoveredInterruptedActions.length} interrupted action(s) as UNKNOWN; reconciliation required`);
    console.log(`MCP endpoint: http://127.0.0.1:${PORT}/mcp`);
    console.log(`MCP Bearer token: ${mcpAccess.token}`);
    console.log(status.configured ? `AI: OpenAI ${status.model}` : 'AI: API 키 없음 → 로컬 폴백 모드');
  });
}

module.exports = { server, validateContextStillFresh, handleOrchestratePlan, handleOrchestrateExecute, validatePlanFresh, createNorthboundPlan, executeOrchestrationPlan, mcpServer };
