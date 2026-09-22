const { getDeviceGraphContext, GRAPH_VERSION } = require('./device-graph');
const { actionContext, CONTEXT_GRAPH_VERSION } = require('./context-graph');

const POLICY_VERSION = 'reality-policy/1.4.3';

const RISK = { low:1, medium:2, high:3, critical:4 };

const capabilityRisk = {
  turn_on:'low', turn_off:'low', set_brightness:'low', display_message:'low',
  open_app:'low', open_url:'low', open_site:'low', web_search:'low', open_folder:'low',
  open_special_location:'low', open_system:'low', run_workflow:'medium', close_app:'medium',
  lock:'medium', power_action:'high', unlock:'high',
};

const rolePermissions = {
  owner:{ low:'auto', medium:'confirm', high:'confirm' },
  family:{ low:'auto', medium:'confirm', high:'blocked' },
  guest:{ low:'auto', medium:'blocked', high:'blocked' },
};

function evaluatePolicy({ identity, device, capability, args = {}, context = {} }) {
  const rules = [];
  const safetyChecks = [];
  let graphContext = null;
  let liveContext = null;

  if (!identity || !identity.policy_identity) {
    return decision('blocked','critical','Reality Layer 정책 Identity가 없어 현실 행동을 실행할 수 없습니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }
  if (!device) {
    return decision('blocked','critical','존재하지 않는 기기입니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }
  if (!device.capabilities.includes(capability)) {
    return decision('blocked','critical','이 기기가 지원하지 않는 동작입니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }

  graphContext = getDeviceGraphContext(device.id, identity);
  liveContext = actionContext(device.id, identity.id);
  rules.push(`graph:${GRAPH_VERSION}`);
  rules.push(`context-graph:${CONTEXT_GRAPH_VERSION}`);

  if (!graphContext) {
    return decision('blocked','critical','Device Graph에 등록되지 않은 기기라 Reality Layer가 영향 범위를 검증할 수 없습니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }
  if (!liveContext) {
    return decision('blocked','critical','Context Graph에서 현재 행동의 영향을 계산할 수 없습니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }

  safetyChecks.push({
    name:'device_graph_access', passed:graphContext.actor_graph_access,
    detail:graphContext.actor_graph_access ? `${identity.role} 역할이 ${device.name} 제어 관계에 포함됨` : `${identity.role} 역할이 이 기기의 제어 관계에 없음`,
  });
  if (!graphContext.actor_graph_access) {
    return decision('blocked','critical',`Device Graph 정책상 현재 Identity는 ${graphContext.space?.name || '해당 공간'}의 이 기기를 제어할 관계가 없습니다.`,identity,rules,safetyChecks,graphContext,liveContext);
  }

  rules.push(`impact:${graphContext.impact_scope}`);
  rules.push(`safety-class:${graphContext.safety_class}`);

  const risk = capabilityRisk[capability] || 'critical';
  rules.push(`risk:${risk}`);
  const roleDecision = rolePermissions[identity.role]?.[risk] || 'blocked';
  rules.push(`role:${identity.role}:${roleDecision}`);

  const otherOccupants = liveContext.other_occupants || [];
  safetyChecks.push({
    name:'affected_space_occupancy',
    passed:otherOccupants.length === 0,
    detail:otherOccupants.length ? `영향 공간에 다른 사람 ${otherOccupants.map((o)=>`${o.name}@${o.space_name}`).join(', ')} 재실` : '영향 공간에 다른 재실자 없음',
  });

  if (graphContext.impact_scope === 'security_perimeter') {
    safetyChecks.push({ name:'security_perimeter', passed:true, detail:'이 기기는 집의 출입 경계를 바꾸므로 민감 정책을 적용함' });
    const realPhysicalAccess = device.adapter_id && !String(device.adapter_id).startsWith('virtual_');
    if (realPhysicalAccess && identity.real_world_verified !== true) {
      safetyChecks.push({ name:'verified_real_identity', passed:false, detail:'현재 Identity는 데모 역할 전환이며 실제 사용자 인증이 아님' });
      return decision('blocked','critical','실제 출입·보안 기기는 검증된 사용자 Identity가 구현되기 전까지 제어할 수 없습니다.',identity,rules,safetyChecks,graphContext,liveContext);
    }
  }
  if (graphContext.impact_scope === 'private_space' && identity.role === 'guest') {
    return decision('blocked',risk,'Guest Identity는 Device Graph상 private space 기기를 제어할 수 없습니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }
  if (graphContext.impact_scope === 'personal' && !graphContext.actor_is_owner) {
    return decision('blocked',risk,'개인 소유 기기는 Device Graph의 소유자만 제어할 수 있습니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }

  if (capability === 'unlock') {
    rules.push('sensitive:physical-access');
    if (identity.role !== 'owner') {
      return decision('blocked',risk,'문 잠금 해제는 Owner Identity만 요청할 수 있습니다.',identity,rules,safetyChecks,graphContext,liveContext);
    }
    const actorLocation = liveContext.actor?.present ? liveContext.actor.location : null;
    const locationOk = actorLocation === graphContext.space?.id || (context.current_location === graphContext.space?.id && ['resolved','manual'].includes(context.current_location_status));
    safetyChecks.push({ name:'requester_near_security_boundary', passed:locationOk, detail:locationOk ? `${graphContext.space?.name} 재실 Context 확인됨` : `${graphContext.space?.name || '보안 경계'} 근처라는 Context를 확인하지 못함` });
    if (!locationOk) {
      return decision('blocked',risk,'현관문 잠금 해제는 요청자가 Device Graph상 해당 보안 경계 공간에 있다는 Context가 확인될 때만 허용됩니다.',identity,rules,safetyChecks,graphContext,liveContext);
    }
    return decision('confirm',risk,'물리적 접근 권한을 변경하는 민감한 행동이라 사용자 확인이 필요합니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }

  if (capability === 'power_action') {
    rules.push('sensitive:session-state');
    const action = String(args.power_action || 'unknown');
    safetyChecks.push({ name:'known_power_action', passed:Boolean(action), detail:action });
    if (identity.role !== 'owner') {
      return decision('blocked',risk,'전원·세션 동작은 개인 소유 기기의 Owner Identity만 수행할 수 있습니다.',identity,rules,safetyChecks,graphContext,liveContext);
    }
    return decision('confirm',risk,'작업 손실이나 세션 종료 가능성이 있어 확인이 필요합니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }

  if (capability === 'close_app') {
    rules.push('sensitive:unsaved-work');
    return decision(roleDecision === 'blocked' ? 'blocked' : 'confirm',risk,roleDecision === 'blocked' ? '현재 Identity는 앱 종료 권한이 없습니다.' : '저장되지 않은 작업이 있을 수 있어 확인이 필요합니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }

  if (capability === 'lock') {
    rules.push('sensitive:physical-lock');
    if (identity.role === 'guest') {
      return decision('blocked',risk,'Guest Identity는 문 잠금 상태를 변경할 수 없습니다.',identity,rules,safetyChecks,graphContext,liveContext);
    }
    return decision('confirm',risk,otherOccupants.length ? '현관 영향 범위에 다른 사람이 있어 출입 상태 변경 전 확인이 필요합니다.' : '출입 상태를 바꾸는 행동이라 확인이 필요합니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }

  // Context Graph가 단순 권한을 넘어 "누구에게 영향을 주는지"를 반영한다.
  if (['turn_off','set_brightness'].includes(capability) && otherOccupants.length > 0) {
    rules.push('context:other-occupants-affected');
    if (identity.role === 'guest') {
      return decision('blocked',risk,'다른 사람이 사용 중인 공간의 환경을 Guest가 변경하지 않도록 차단했습니다.',identity,rules,safetyChecks,graphContext,liveContext);
    }
    return decision('confirm',risk,`영향 공간에 ${otherOccupants.map((o)=>o.name).join(', ')}가 있어 환경 변경 전 확인이 필요합니다.`,identity,rules,safetyChecks,graphContext,liveContext);
  }

  if (roleDecision === 'blocked') {
    return decision('blocked',risk,'현재 Identity의 역할 정책에서 이 위험도의 행동은 차단됩니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }
  if (roleDecision === 'confirm') {
    return decision('confirm',risk,'현재 Identity와 행동 위험도 조합상 사용자 확인이 필요합니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }

  safetyChecks.push({ name:'device_online', passed:device.state?.status !== 'offline', detail:device.state?.status || 'available' });
  if (device.state?.status === 'offline') {
    return decision('blocked',risk,'기기가 오프라인 상태라 실행하지 않습니다.',identity,rules,safetyChecks,graphContext,liveContext);
  }

  return decision('auto',risk,'Identity·Device Graph·실시간 Context Graph·위험도·안전 검사를 모두 통과한 저위험 행동입니다.',identity,rules,safetyChecks,graphContext,liveContext);
}

function decision(level,risk,reason,identity,matchedRules,safetyChecks,graphContext,liveContext) {
  return {
    policy_version:POLICY_VERSION,
    graph_version:GRAPH_VERSION,
    context_graph_version:CONTEXT_GRAPH_VERSION,
    allowed:level !== 'blocked', level, decision:level, risk,
    risk_score:RISK[risk] || RISK.critical,
    reason,
    actor:identity ? { id:identity.id, name:identity.name, role:identity.role, trust_level:identity.trust_level, identity_assurance:identity.identity_assurance, real_world_verified:identity.real_world_verified === true } : null,
    graph_context:graphContext,
    context_graph:liveContext,
    matched_rules:matchedRules,
    safety_checks:safetyChecks,
  };
}

function publicPolicySpec() {
  return {
    version:POLICY_VERSION,
    graph_version:GRAPH_VERSION,
    context_graph_version:CONTEXT_GRAPH_VERSION,
    risk_levels:capabilityRisk,
    role_policy:rolePermissions,
    decisions:['auto','confirm','blocked'],
    principle:'AI does not authorize itself. Reality Layer evaluates policy Identity + static Device Graph + live Context Graph + capability risk + safety rules independently. Demo role switching is not real authentication.',
  };
}

module.exports = { evaluatePolicy, publicPolicySpec, POLICY_VERSION, capabilityRisk, rolePermissions };
