const $ = (s) => document.querySelector(s);
let currentRequest = null;
let currentPermission = null;
let currentIdentity = null;
let currentPlanId = null;
let currentPlanDecision = null;

async function api(url, options = {}) {
  const session = await fetch('/api/session').then(r=>r.json());
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', 'X-Reality-Token':session.token }, ...options });
  const data = await res.json();
  if (!res.ok && !data.needs_confirmation) {
    const error = new Error(data.error || '요청 실패');
    error.data = data;
    throw error;
  }
  return data;
}

function esc(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (ch) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[ch]));
}

function prettyState(device) {
  const s = device.state || {};
  if (device.type === 'windows_pc') return `${s.status === 'ready' ? 'READY' : String(s.status || '').toUpperCase()}${s.last_target ? ` · 마지막: ${s.last_target_name || s.last_target}` : ''}`;
  if (device.type === 'light') return `${s.power === 'on' ? 'ON' : 'OFF'} · 밝기 ${s.brightness}%`;
  if (device.type === 'air_conditioner') return s.power === 'on' ? 'ON' : 'OFF';
  if (device.type === 'door') return s.lock === 'locked' ? 'LOCKED' : 'UNLOCKED';
  if (device.type === 'display') return `${s.power === 'on' ? 'ON' : 'OFF'} · ${s.message || ''}`;
  return JSON.stringify(s);
}


function renderIdentityPolicy(data) {
  if (!data) return;
  const identities = data.identities || [];
  const identity = data.identity || identities[0];
  currentIdentity = identity || null;
  const select = $('#identitySelect');
  if (select && identities.length) {
    const previous = select.value;
    select.innerHTML = identities.map((item) => `<option value="${esc(item.id)}">${esc(item.name)} · ${esc(item.role)}</option>`).join('');
    select.value = identity?.id || previous || identities[0].id;
  }
  if ($('#identityBadge')) $('#identityBadge').textContent = identity ? `${identity.name} · ${identity.role} · trust ${identity.trust_level}` : '-';
  if ($('#identityDescription')) $('#identityDescription').textContent = identity?.description || '-';
  if ($('#policyVersionBadge')) $('#policyVersionBadge').textContent = data.policy?.version || 'Reality Policy';
}

function renderPolicyDecision(policy) {
  if (!policy) {
    $('#permissionBox').className = 'permission neutral';
    $('#permissionBox').innerHTML = '<strong>Reality Policy</strong><span>아직 평가되지 않음</span>';
    if ($('#policyJson')) $('#policyJson').textContent = '{}';
    return;
  }
  const level = policy.level || policy.decision || 'blocked';
  $('#permissionBox').className = `permission ${level}`;
  $('#permissionBox').innerHTML = `<strong>Reality Policy · ${String(level).toUpperCase()} · RISK ${esc(policy.risk || '-')}</strong><span>${esc(policy.reason || '')}</span>`;
  if ($('#policyJson')) $('#policyJson').textContent = JSON.stringify({
    policy_version: policy.policy_version,
    actor: policy.actor,
    decision: policy.decision,
    risk: policy.risk,
    matched_rules: policy.matched_rules,
    graph_version: policy.graph_version,
    context_graph_version: policy.context_graph_version,
    graph_context: policy.graph_context,
    context_graph: policy.context_graph,
    safety_checks: policy.safety_checks,
  }, null, 2);
}

function engineLabel(data) {
  if (data.engine === 'openai') return `AI · ${data.model || 'OpenAI'}`;
  if (data.engine === 'local-fallback') return 'LOCAL FALLBACK';
  return '대기';
}

function renderContext(context) {
  if (!context) return;
  $('#currentLocationBadge').textContent = `위치: ${context.current_location_name || '확정 안 됨'} · ${Math.round((context.current_location_confidence || 0) * 100)}%`;
  $('#contextSourceBadge').textContent = `출처: ${context.current_location_source_name || context.current_location_source}`;
  $('#contextStatusBadge').textContent = `상태: ${context.current_location_status_name || context.current_location_status}`;
  $('#lastDeviceBadge').textContent = `최근 기기: ${context.last_device_name || '없음'}`;
  $('#contextReason').textContent = context.context_reason || '-';
  if (context.current_location) $('#locationSelect').value = context.current_location;

  const scores = context.location_scores || [];
  $('#scoreBars').innerHTML = scores.map((item) => `<div class="score-row"><span>${esc(item.name || item.location)}</span><div class="score-track"><i style="width:${Math.round((item.score || 0) * 100)}%"></i></div><strong>${Math.round((item.score || 0) * 100)}%</strong></div>`).join('');

  const evidence = context.evidence || [];
  $('#evidenceList').innerHTML = evidence.length
    ? evidence.map((item) => `<span class="evidence-chip">${esc(item.sensor_name)} · 기여 ${Math.round((item.contribution || 0) * 100)}%</span>`).join('')
    : '<span class="muted small">활성 센서 증거 없음</span>';
}

function renderSensors(sensors) {
  $('#sensorButtons').innerHTML = sensors.map((s) => {
    const active = s.state?.detected ? ' active' : '';
    return `<button class="sensor-btn${active}" data-sensor="${esc(s.id)}" data-active="${s.state?.detected ? 'true' : 'false'}"><strong>${esc(s.name)}</strong><span>${esc(s.type)} · 신뢰도 ${Math.round((s.reliability || 0) * 100)}%</span><em>${s.state?.detected ? '활성 · 눌러서 해제' : '비활성 · 눌러서 감지'}</em></button>`;
  }).join('');
  document.querySelectorAll('[data-sensor]').forEach((button) => button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const detected = button.dataset.active !== 'true';
      const data = await api('/api/sensor-event', { method:'POST', body: JSON.stringify({ sensor_id: button.dataset.sensor, detected }) });
      renderContext(data.context);
      renderSensors(data.sensors);
      const contextGraph = await api('/api/context-graph');
      renderContextGraph(contextGraph);
  renderOrchestratorStatus(orchestrator);
      await refreshLogsOnly();
    } catch (e) {
      $('#explanation').textContent = e.message;
    } finally {
      button.disabled = false;
    }
  }));
}

function renderPcRegistry(registry) {
  const apps = registry.apps || [];
  const available = apps.filter((a)=>a.available).length;
  $('#registryCount').textContent = `${available}/${apps.length} 앱 감지`;
  const appCards = apps.map((app)=>`<div class="registry-item ${app.available ? 'available' : 'missing'}"><strong>${esc(app.name)}</strong><span>${app.available ? '감지됨' : '경로 미확인'}</span><small>${esc(app.id)}${app.custom ? ' · custom' : ''}</small></div>`).join('');
  const extras = [
    ['사이트', (registry.sites || []).map((x)=>x.name).join(', ')],
    ['검색', (registry.search_providers || []).join(', ')],
    ['폴더', (registry.folders || []).map((x)=>x.name).join(', ')],
    ['탐색기 위치', (registry.special_locations || []).map((x)=>x.name).join(', ')],
    ['Windows 기능', (registry.system_targets || []).map((x)=>x.name).join(', ')],
    ['전원/세션 · 확인 필요', (registry.power_actions || []).map((x)=>x.name).join(', ')],
    ['작업 조합', (registry.workflows || []).map((x)=>x.name).join(', ')],
    ['의도적으로 차단', (registry.blocked_categories || []).join(', ')],
  ].map(([title,text])=>`<div class="registry-extra"><strong>${esc(title)}</strong><span>${esc(text)}</span></div>`).join('');
  $('#pcRegistry').innerHTML = `<div class="registry-apps">${appCards}</div><div class="registry-extras">${extras}</div>`;
}

function renderDeviceRegistry(registry) {
  const devices = registry.devices || [];
  const adapters = registry.adapters || [];
  $('#deviceRegistryCount').textContent = `${devices.length} devices · ${adapters.length} adapters`;
  const cards = devices.map((d) => `<div class="registry-item available"><strong>${esc(d.name)}</strong><span>${esc(d.type)} · ${esc(d.location)}</span><small>${esc(d.adapter_id)} · ${esc(d.protocol)} · ${esc(d.interface_version)}</small><small>${esc((d.capabilities || []).join(', '))}</small></div>`).join('');
  const spec = registry.interface || {};
  const extras = `<div class="registry-extra"><strong>${esc(spec.version || 'UAG')}</strong><span>${esc(spec.rule || '')}</span></div>`;
  $('#deviceRegistry').innerHTML = `<div class="registry-apps">${cards}</div><div class="registry-extras">${extras}</div>`;
}


function renderDeviceGraph(graphData) {
  const graph = graphData?.graph || graphData || {};
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const deviceNodes = nodes.filter((n)=>n.kind === 'device');
  const spaceNodes = nodes.filter((n)=>n.kind === 'space' || n.kind === 'environment');
  const relationCounts = edges.reduce((acc,e)=>{ acc[e.type]=(acc[e.type]||0)+1; return acc; },{});
  if ($('#graphVersionBadge')) $('#graphVersionBadge').textContent = graph.version || 'Device Graph';
  if ($('#graphSummary')) $('#graphSummary').textContent = `${nodes.length} nodes · ${edges.length} relations · ${graph.validation?.ok ? 'VALID' : 'CHECK'}`;

  const deviceCards = deviceNodes.map((n)=>{
    const space = nodes.find((x)=>x.id === n.space_id);
    return `<div class="graph-device"><strong>${esc(n.name)}</strong><span>${esc(n.device_type)} · ${esc(space?.name || n.space_id)}</span><small>owner ${esc(n.owner_id)} · ${esc(n.impact_scope)} · ${esc(n.safety_class)}</small><small>roles: ${esc((n.allowed_roles||[]).join(', '))}</small></div>`;
  }).join('');
  const spaces = spaceNodes.map((n)=>`<span class="graph-chip"><strong>${esc(n.name)}</strong> · ${esc(n.privacy || n.kind)}</span>`).join('');
  const relations = Object.entries(relationCounts).map(([type,count])=>`<span class="graph-chip">${esc(type)} × ${count}</span>`).join('');
  $('#deviceGraph').innerHTML = `<div class="graph-devices">${deviceCards}</div><div class="graph-side"><div><h3>Spaces</h3><div class="graph-chips">${spaces}</div></div><div><h3>Relations</h3><div class="graph-chips">${relations}</div></div></div>`;
}

function renderContextGraph(graphData) {
  const graph = graphData?.graph || graphData || {};
  const nodes = graph.nodes || [];
  const edges = graph.edges || [];
  const actorNodes = nodes.filter((n)=>n.kind === 'identity');
  const stateNodes = nodes.filter((n)=>n.kind === 'device_state');
  const occupied = edges.filter((e)=>e.type === 'occupied_by');
  if ($('#contextGraphVersionBadge')) $('#contextGraphVersionBadge').textContent = graph.version || 'Context Graph';
  if ($('#contextGraphSummary')) $('#contextGraphSummary').textContent = `${actorNodes.filter((a)=>a.present).length} present · ${occupied.length} occupied · ${stateNodes.length} live states`;

  const actors = actorNodes.map((a)=>`<div class="context-actor ${a.present ? 'present' : ''}"><strong>${esc(a.name)}</strong><span>${a.present ? `${esc(a.location_name || a.location)} · ${Math.round((a.context_confidence || 0)*100)}%` : '부재/위치 없음'}</span><span>${esc(a.context_source || '-')}</span></div>`).join('');
  const facts = [];
  for (const edge of occupied) {
    const space = nodes.find((n)=>n.id === edge.from);
    const actor = nodes.find((n)=>n.id === edge.to);
    facts.push(`<div class="context-fact"><strong>${esc(space?.name || edge.from)} occupied_by ${esc(actor?.name || edge.to)}</strong><span>confidence ${Math.round((edge.confidence || 0)*100)}% · ${esc(edge.source || '')}</span></div>`);
  }
  for (const state of stateNodes) {
    facts.push(`<div class="context-fact"><strong>${esc(state.name)}</strong><span>${esc(JSON.stringify(state.state || {}))}</span></div>`);
  }
  $('#contextGraph').innerHTML = `<div class="context-actors"><h3>People / Presence</h3>${actors}</div><div class="context-facts"><h3>Live Relations / State</h3>${facts.join('') || '<span class="muted small">동적 관계 없음</span>'}</div>`;
}


function renderOrchestratorStatus(data) {
  const spec = data?.orchestrator || data || {};
  if ($('#orchestratorVersionBadge')) $('#orchestratorVersionBadge').textContent = spec.version || 'Reality Orchestrator';
}

function renderPlan(plan) {
  if (!plan || !plan.intent) {
    currentPlanId = null; currentPlanDecision = null;
    $('#planDecisionBadge').textContent = '계획 없음';
    $('#planDecisionBadge').className = 'badge';
    $('#planSummaryBadge').textContent = '-';
    $('#planExplanation').textContent = plan?.reason || '상위 의도를 입력하고 계획 만들기를 눌러봐.';
    $('#planSteps').innerHTML = '<p class="muted">아직 생성된 계획이 없어.</p>';
    $('#executePlanBtn').disabled = true;
    return;
  }
  currentPlanId = plan.plan_id || null;
  currentPlanDecision = plan.decision || 'blocked';
  const d = String(currentPlanDecision).toUpperCase();
  $('#planDecisionBadge').textContent = `PLAN ${d}`;
  $('#planDecisionBadge').className = `badge plan-${currentPlanDecision}`;
  const sm = plan.summary || {};
  $('#planSummaryBadge').textContent = `${sm.executable || 0} 실행 · ${sm.skipped || 0} 생략 · ${sm.confirm || 0} 확인 · ${sm.blocked || 0} 차단`;
  $('#planExplanation').textContent = `${plan.title || plan.intent} · ${plan.explanation || ''} ${plan.reason || ''}`.trim();
  $('#planSteps').innerHTML = (plan.steps || []).map((step, i) => {
    const level = step.status === 'skipped' ? 'skipped' : (step.policy?.level || step.status || 'planned');
    const reason = step.skip_reason || step.policy?.reason || '';
    const critical = step.optional ? '선택 단계' : '필수 단계';
    return `<div class="plan-step ${esc(level)}"><div class="plan-step-index">${i+1}</div><div><strong>${esc(step.title || step.id)}</strong><span>${esc(step.device)} → ${esc(step.capability)} · ${esc(critical)}</span><small>${esc(String(level).toUpperCase())}${reason ? ` · ${esc(reason)}` : ''}</small></div></div>`;
  }).join('');
  $('#executePlanBtn').disabled = !plan.ok || !currentPlanId || currentPlanDecision === 'blocked';
  $('#executePlanBtn').textContent = currentPlanDecision === 'confirm' ? '확인 후 계획 실행' : '계획 실행';
}

async function createPlan() {
  const text = $('#orchestratorInput').value.trim();
  $('#planBtn').disabled = true;
  $('#executePlanBtn').disabled = true;
  $('#planResult').textContent = '';
  try {
    const data = await api('/api/orchestrate-plan', { method:'POST', body:JSON.stringify({ text }) });
    renderPlan(data);
    if (data.context) renderContext(data.context);
  } catch (e) {
    renderPlan({ reason:e.message });
  } finally { $('#planBtn').disabled = false; }
}

async function executePlan(forceConfirmed = false) {
  if (!currentPlanId) return;
  if (currentPlanDecision === 'confirm' && !forceConfirmed) {
    $('#planConfirmText').textContent = '이 계획에는 확인이 필요한 현실 행동이 포함되어 있어. 전체 계획을 실행할까?';
    $('#planConfirmDialog').showModal();
    return;
  }
  $('#executePlanBtn').disabled = true;
  try {
    const data = await api('/api/orchestrate-execute', { method:'POST', body:JSON.stringify({ plan_id:currentPlanId, confirmed:forceConfirmed }) });
    const lines = (data.results || []).map((r)=>`${r.title}: ${String(r.status).toUpperCase()}${r.reason ? ` — ${r.reason}` : ''}`);
    $('#planResult').textContent = `${data.status === 'completed' ? '계획 완료' : '계획 중단'} · ${data.summary?.executed || 0} 실행 / ${data.summary?.skipped || 0} 생략 / ${data.summary?.failed || 0} 실패\n${lines.join('\n')}`;
    currentPlanId = null; currentPlanDecision = null;
    $('#executePlanBtn').disabled = true; $('#executePlanBtn').textContent = '계획 실행 완료';
    await refresh();
  } catch (e) {
    $('#planResult').textContent = e.data?.plan_stale ? `현실 상태 변경으로 계획 폐기: ${e.message}` : e.message;
    if (e.data?.plan_stale) { currentPlanId = null; currentPlanDecision = null; $('#executePlanBtn').disabled = true; $('#executePlanBtn').textContent = '계획 다시 만들기 필요'; }
    else $('#executePlanBtn').disabled = false;
  }
}

function renderLogs(logs, events) {
  $('#logCount').textContent = logs.length;
  $('#logs').innerHTML = logs.length ? logs.map((l) => `<div class="log"><time>${new Date(l.at).toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><code>${esc(l.device_name || l.device)} → ${esc(l.capability)}</code><span>${esc(l.result)}</span></div>`).join('') : '<p class="muted">아직 실행 기록이 없어.</p>';
  $('#eventCount').textContent = events.length;
  $('#events').innerHTML = events.length ? events.map((e) => `<div class="log"><time>${new Date(e.at).toLocaleTimeString('ko-KR', {hour:'2-digit',minute:'2-digit',second:'2-digit'})}</time><code>${esc(e.sensor_name || e.sensor_id)}</code><span>${e.detected ? 'ACTIVE' : 'CLEAR'}</span></div>`).join('') : '<p class="muted">아직 센서 이벤트가 없어.</p>';
}

async function refreshLogsOnly() {
  const [{ logs }, { events }] = await Promise.all([api('/api/logs'), api('/api/sensor-events')]);
  renderLogs(logs, events);
}

async function refresh() {
  const [{ devices }, { logs }, { events }, ai, { context }, { sensors }, registry, deviceRegistry, realityPolicy, deviceGraph, contextGraph, orchestrator] = await Promise.all([
    api('/api/state'), api('/api/logs'), api('/api/sensor-events'), api('/api/ai-status'), api('/api/context'), api('/api/sensors'), api('/api/pc-registry'), api('/api/device-registry'), api('/api/reality-policy'), api('/api/device-graph'), api('/api/context-graph'), api('/api/orchestrator')
  ]);
  $('#aiStatus').textContent = ai.configured ? `AI 연결됨 · ${ai.model}` : 'API 키 없음 · 로컬 폴백';
  $('#aiStatus').className = ai.configured ? 'badge status-ai' : 'badge';
  renderContext(context);
  renderSensors(sensors);
  renderPcRegistry(registry);
  renderDeviceRegistry(deviceRegistry);
  renderIdentityPolicy(realityPolicy);
  renderDeviceGraph(deviceGraph);
  renderContextGraph(contextGraph);
  $('#devices').innerHTML = devices.map((d) => {
    const state = prettyState(d);
    const cls = /UNLOCKED/.test(state) ? 'state-alert' : /\bON\b|LOCKED/.test(state) ? 'state-on' : 'state-off';
    return `<div class="device"><h3>${esc(d.name)}</h3><p>${esc(d.type)} · ${esc(d.location)}</p><p class="muted small">${esc(d.adapter_id || '')} · ${esc(d.protocol || '')}</p><p class="${cls}"><strong>${esc(state)}</strong></p></div>`;
  }).join('');
  renderLogs(logs, events);
}

async function interpretCommand() {
  const text = $('#commandInput').value.trim();
  $('#interpretBtn').disabled = true; $('#executeBtn').disabled = true; $('#confidence').textContent = '해석 중…';
  try {
    const data = await api('/api/interpret', { method:'POST', body: JSON.stringify({ text }) });
    $('#engineBadge').textContent = engineLabel(data);
    renderContext(data.context);
    if (!data.ok) {
      currentRequest = null; currentPermission = null;
      $('#confidence').textContent = '이해 실패';
      $('#explanation').textContent = `${data.reason || ''} ${data.suggestion || ''}`.trim();
      $('#contextUsed').textContent = '';
      $('#actionJson').textContent = '{}';
      $('#unifiedJson').textContent = '{}';
      if (data.policy || data.permission) renderPolicyDecision(data.policy || data.permission);
      else renderPolicyDecision({ level:'blocked', decision:'blocked', risk:'-', reason:'실행할 명령 없음' });
      if (data.identity) renderIdentityPolicy({ identity:data.identity, identities:[data.identity], policy:{ version:data.policy?.policy_version || 'reality-policy/1.4.3' } });
      $('#warning').textContent = data.warning || '';
      return;
    }
    currentRequest = data.request_id; currentPermission = data.permission;
    $('#confidence').textContent = `신뢰도 ${Math.round(data.confidence * 100)}%`;
    $('#explanation').textContent = data.explanation;
    $('#contextUsed').textContent = data.context_used?.length ? `Context 사용: ${data.context_used.join(', ')}` : 'Context 사용 안 함';
    $('#actionJson').textContent = JSON.stringify(data.action, null, 2);
    $('#unifiedJson').textContent = JSON.stringify(data.unified_command || {}, null, 2);
    renderPolicyDecision(data.policy || data.permission);
    if (data.identity) currentIdentity = data.identity;
    $('#warning').textContent = data.warning || '';
    $('#executeBtn').disabled = !data.permission.allowed;
    $('#executeBtn').textContent = data.permission.level === 'confirm' ? '확인 후 실행' : '실행';
  } catch (e) { $('#confidence').textContent = '오류'; $('#explanation').textContent = e.message; }
  finally { $('#interpretBtn').disabled = false; }
}

async function executeCurrent(forceConfirmed = false) {
  if (!currentRequest) return;
  if (currentPermission?.level === 'confirm' && !forceConfirmed) { $('#confirmText').textContent = currentPermission.reason + ' 정말 실행할까?'; $('#confirmDialog').showModal(); return; }
  $('#executeBtn').disabled = true;
  try {
    const data = await api('/api/execute', { method:'POST', body: JSON.stringify({ request_id: currentRequest, confirmed: forceConfirmed }) });
    renderContext(data.context); currentRequest = null; currentPermission = null; $('#executeBtn').textContent = '실행 완료'; await refresh();
  } catch (e) {
    $('#executeBtn').disabled = false;
    $('#explanation').textContent = e.data?.context_changed ? `Context 변경으로 실행 차단: ${e.message}` : e.data?.identity_changed ? `Identity 변경으로 실행 차단: ${e.message}` : e.data?.graph_changed ? `Device Graph 변경으로 실행 차단: ${e.message}` : e.data?.context_graph_changed ? `Context Graph 변경으로 실행 차단: ${e.message}` : e.message;
    if (e.data?.context) renderContext(e.data.context);
    if (e.data?.context_changed || e.data?.identity_changed || e.data?.graph_changed || e.data?.context_graph_changed) { currentRequest = null; currentPermission = null; $('#executeBtn').disabled = true; $('#executeBtn').textContent = '다시 해석 필요'; }
  }
}

$('#identitySelect').addEventListener('change', async () => {
  try {
    const data = await api('/api/identity', { method:'POST', body:JSON.stringify({ identity_id:$('#identitySelect').value }) });
    currentRequest = null; currentPermission = null; $('#executeBtn').disabled = true; $('#executeBtn').textContent = '실행';
    renderIdentityPolicy({ identity:data.identity, identities:data.identities, policy:{ version:'reality-policy/1.4.3' } });
    renderPolicyDecision(null);
    await refresh();
  } catch (e) { $('#explanation').textContent = e.message; }
});

$('#planBtn').addEventListener('click', createPlan);
$('#orchestratorInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') createPlan(); });
$('#executePlanBtn').addEventListener('click', () => executePlan(false));
document.querySelectorAll('[data-plan-example]').forEach((b) => b.addEventListener('click', () => { $('#orchestratorInput').value = b.dataset.planExample; $('#orchestratorInput').focus(); }));
$('#planConfirmDialog').addEventListener('close', async () => { if ($('#planConfirmDialog').returnValue === 'confirm') await executePlan(true); });
$('#interpretBtn').addEventListener('click', interpretCommand);
$('#commandInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') interpretCommand(); });
$('#executeBtn').addEventListener('click', () => executeCurrent(false));
$('#manualBtn').addEventListener('click', async () => { const data = await api('/api/context', { method:'POST', body: JSON.stringify({ current_location: $('#locationSelect').value }) }); renderContext(data.context); if (data.context_graph) renderContextGraph(data.context_graph); else renderContextGraph(await api('/api/context-graph')); });
$('#autoContextBtn').addEventListener('click', async () => { const data = await api('/api/context/auto', { method:'POST', body:'{}' }); renderContext(data.context); if (data.context_graph) renderContextGraph(data.context_graph); else renderContextGraph(await api('/api/context-graph')); });
$('#presenceSetBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/context-graph/actor', { method:'POST', body:JSON.stringify({ actor_id:$('#presenceActorSelect').value, present:true, location:$('#presenceLocationSelect').value }) });
    renderContextGraph(data.graph);
  } catch (e) { $('#explanation').textContent = e.message; }
});
$('#presenceAwayBtn').addEventListener('click', async () => {
  try {
    const data = await api('/api/context-graph/actor', { method:'POST', body:JSON.stringify({ actor_id:$('#presenceActorSelect').value, present:false, location:null }) });
    renderContextGraph(data.graph);
  } catch (e) { $('#explanation').textContent = e.message; }
});
$('#resetBtn').addEventListener('click', async () => { await api('/api/reset', { method:'POST', body:'{}' }); currentRequest=null; currentPermission=null; currentPlanId=null; currentPlanDecision=null; $('#executeBtn').disabled=true; $('#executeBtn').textContent='실행'; $('#contextUsed').textContent=''; $('#actionJson').textContent='{}'; $('#unifiedJson').textContent='{}'; renderPolicyDecision(null); await refresh(); });
document.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => { $('#commandInput').value = b.dataset.example; $('#commandInput').focus(); }));
$('#confirmDialog').addEventListener('close', async () => { if ($('#confirmDialog').returnValue === 'confirm') await executeCurrent(true); });

refresh();
