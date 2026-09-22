const identities = {
  owner: {
    id: 'owner',
    name: 'Owner',
    role: 'owner',
    authenticated: false,
    policy_identity: true,
    identity_assurance: 'demo',
    authentication_mode: 'role_switch_simulation',
    real_world_verified: false,
    trust_level: 'high',
    description: '정책 시뮬레이션용 Owner 역할. 실제 로그인·생체인증을 의미하지 않음.',
  },
  family: {
    id: 'family',
    name: 'Family Member',
    role: 'family',
    authenticated: false,
    policy_identity: true,
    identity_assurance: 'demo',
    authentication_mode: 'role_switch_simulation',
    real_world_verified: false,
    trust_level: 'medium',
    description: '정책 시뮬레이션용 Family 역할. 실제 사용자 인증을 의미하지 않음.',
  },
  guest: {
    id: 'guest',
    name: 'Guest',
    role: 'guest',
    authenticated: false,
    policy_identity: true,
    identity_assurance: 'demo',
    authentication_mode: 'role_switch_simulation',
    real_world_verified: false,
    trust_level: 'low',
    description: '정책 시뮬레이션용 Guest 역할. 실제 사용자 인증을 의미하지 않음.',
  },
};

let currentIdentityId = 'owner';

function getIdentity() {
  return { ...identities[currentIdentityId] };
}

function setIdentity(id) {
  if (!identities[id]) throw new Error('등록되지 않은 Identity입니다.');
  currentIdentityId = id;
  return getIdentity();
}

function publicIdentities() {
  return Object.values(identities).map((identity) => ({ ...identity }));
}

function resetIdentity() {
  currentIdentityId = 'owner';
  return getIdentity();
}

module.exports = { getIdentity, setIdentity, publicIdentities, resetIdentity, identities };
