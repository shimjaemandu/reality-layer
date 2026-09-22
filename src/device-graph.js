const { devices } = require('./devices');

const GRAPH_VERSION = 'reality-device-graph/1.1';

const spaces = {
  home: { id:'home', kind:'environment', name:'집', parent:null, privacy:'shared' },
  living_room: { id:'living_room', kind:'space', name:'거실', parent:'home', privacy:'shared' },
  bedroom: { id:'bedroom', kind:'space', name:'침실', parent:'home', privacy:'private' },
  entrance: { id:'entrance', kind:'space', name:'현관', parent:'home', privacy:'security_boundary' },
  room: { id:'room', kind:'space', name:'개인 방', parent:'home', privacy:'private' },
};

const actors = {
  owner: { id:'owner', kind:'identity', name:'Owner', role:'owner' },
  family: { id:'family', kind:'identity', name:'Family', role:'family' },
  guest: { id:'guest', kind:'identity', name:'Guest', role:'guest' },
};

const infrastructure = {
  home_network: { id:'home_network', kind:'infrastructure', name:'홈 네트워크', criticality:'medium' },
};

const devicePolicies = {
  my_laptop: {
    owner_id:'owner', space_id:'room', impact_scope:'personal', safety_class:'personal_compute',
    allowed_roles:['owner'], affected_spaces:['room'], depends_on:['home_network'],
  },
  living_room_light: {
    owner_id:'owner', space_id:'living_room', impact_scope:'shared_space', safety_class:'environmental',
    allowed_roles:['owner','family','guest'], affected_spaces:['living_room'], depends_on:[],
  },
  bedroom_light: {
    owner_id:'owner', space_id:'bedroom', impact_scope:'private_space', safety_class:'environmental',
    allowed_roles:['owner','family'], affected_spaces:['bedroom'], depends_on:[],
  },
  front_door: {
    owner_id:'owner', space_id:'entrance', impact_scope:'security_perimeter', safety_class:'physical_access',
    allowed_roles:['owner','family'], affected_spaces:['entrance','home'], depends_on:[],
  },
  room_display: {
    owner_id:'owner', space_id:'room', impact_scope:'shared_information', safety_class:'information_surface',
    allowed_roles:['owner','family','guest'], affected_spaces:['room'], depends_on:['home_network'],
  },
};

function deviceNode(deviceId) {
  const device = devices[deviceId];
  const policy = devicePolicies[deviceId];
  if (!device || !policy) return null;
  return {
    id: device.id,
    kind: 'device',
    name: device.name,
    device_type: device.type,
    space_id: policy.space_id,
    owner_id: policy.owner_id,
    impact_scope: policy.impact_scope,
    safety_class: policy.safety_class,
    allowed_roles: [...policy.allowed_roles],
    affected_spaces: [...policy.affected_spaces],
    depends_on: [...policy.depends_on],
    capabilities: [...device.capabilities],
    adapter_id: device.adapter_id,
    protocol: device.protocol,
  };
}

function allNodes() {
  return [
    ...Object.values(spaces),
    ...Object.values(actors),
    ...Object.values(infrastructure),
    ...Object.keys(devicePolicies).map(deviceNode).filter(Boolean),
  ];
}

function allEdges() {
  const edges = [];
  for (const space of Object.values(spaces)) {
    if (space.parent) edges.push({ from:space.parent, to:space.id, type:'contains' });
  }
  for (const [deviceId, meta] of Object.entries(devicePolicies)) {
    edges.push({ from:meta.space_id, to:deviceId, type:'contains' });
    edges.push({ from:meta.owner_id, to:deviceId, type:'owns' });
    for (const role of meta.allowed_roles) edges.push({ from:role, to:deviceId, type:'may_control' });
    for (const spaceId of meta.affected_spaces) edges.push({ from:deviceId, to:spaceId, type:'affects' });
    for (const dependency of meta.depends_on) edges.push({ from:deviceId, to:dependency, type:'depends_on' });
  }
  edges.push({ from:'front_door', to:'home', type:'secures' });
  return edges;
}

function validateGraph() {
  const nodes = allNodes();
  const ids = new Set(nodes.map((n)=>n.id));
  const issues = [];
  if (ids.size !== nodes.length) issues.push('duplicate_node_id');
  for (const edge of allEdges()) {
    if (!ids.has(edge.from)) issues.push(`missing_from:${edge.from}`);
    if (!ids.has(edge.to)) issues.push(`missing_to:${edge.to}`);
  }
  for (const deviceId of Object.keys(devices)) {
    if (!devicePolicies[deviceId]) issues.push(`device_without_graph_policy:${deviceId}`);
  }
  return { ok:issues.length === 0, issues, node_count:nodes.length, edge_count:allEdges().length };
}

function getDeviceGraphContext(deviceId, identity = null) {
  const node = deviceNode(deviceId);
  if (!node) return null;
  const role = identity?.role || null;
  const relations = allEdges().filter((e)=>e.from === deviceId || e.to === deviceId);
  return {
    graph_version: GRAPH_VERSION,
    device_id: node.id,
    device_name: node.name,
    owner_id: node.owner_id,
    space: spaces[node.space_id] ? { ...spaces[node.space_id] } : null,
    impact_scope: node.impact_scope,
    safety_class: node.safety_class,
    allowed_roles: [...node.allowed_roles],
    affected_spaces: node.affected_spaces.map((id)=>spaces[id] ? { id, name:spaces[id].name, privacy:spaces[id].privacy } : { id }),
    dependencies: node.depends_on.map((id)=>infrastructure[id] ? { ...infrastructure[id] } : { id }),
    actor_role: role,
    actor_is_owner: Boolean(identity && identity.id === node.owner_id),
    actor_graph_access: Boolean(identity && (identity.id === node.owner_id || node.allowed_roles.includes(role))),
    relations,
  };
}

function graphFingerprint(deviceId) {
  const node = deviceNode(deviceId);
  if (!node) return null;
  const payload = [
    GRAPH_VERSION, node.adapter_id, node.protocol, [...node.capabilities].sort().join(','), node.id, node.space_id, node.owner_id, node.impact_scope, node.safety_class,
    [...node.allowed_roles].sort().join(','), [...node.affected_spaces].sort().join(','), [...node.depends_on].sort().join(','),
  ];
  return payload.join('|');
}

function graphSnapshotForDevice(deviceId) {
  return { version:GRAPH_VERSION, device_id:deviceId, fingerprint:graphFingerprint(deviceId) };
}

function validateGraphSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== GRAPH_VERSION || !snapshot.device_id) return false;
  return snapshot.fingerprint === graphFingerprint(snapshot.device_id);
}

function publicDeviceGraph() {
  const validation = validateGraph();
  return {
    version: GRAPH_VERSION,
    principle: 'Reality Layer reasons about ownership, space, impact and dependencies before a device action reaches an adapter.',
    validation,
    nodes: allNodes(),
    edges: allEdges(),
    legend: {
      node_kinds:['environment','space','identity','infrastructure','device'],
      edge_types:['contains','owns','may_control','affects','depends_on','secures'],
      impact_scopes:['personal','shared_space','private_space','security_perimeter','shared_information'],
    },
  };
}

module.exports = {
  GRAPH_VERSION,
  spaces,
  actors,
  infrastructure,
  devicePolicies,
  deviceNode,
  publicDeviceGraph,
  validateGraph,
  getDeviceGraphContext,
  graphSnapshotForDevice,
  validateGraphSnapshot,
};
