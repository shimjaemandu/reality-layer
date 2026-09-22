'use strict';
const { devices } = require('./devices');
const { spaces, actors, publicDeviceGraph, GRAPH_VERSION } = require('./device-graph');
const { publicRealityGraph, REALITY_GRAPH_VERSION } = require('./reality-graph');
const { getStateStore, setActorState, resetActorStates, STATE_STORE_VERSION } = require('./state-store');
const { appendEvent } = require('./event-store');

const CONTEXT_GRAPH_VERSION = 'reality-context-graph/1.3';

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function getContextGraphState() {
  const state = getStateStore();
  const out = { actors:{} };
  for (const actorId of Object.keys(actors)) {
    out.actors[actorId] = { ...clone(state.actors[actorId]), actor_id:actorId };
  }
  return out;
}

function setActorPresence(actorId, { present, location = null, source = 'simulation', confidence = 1 } = {}) {
  const before = getStateStore().actors[actorId] || null;
  const next = setActorState(actorId, { present, location, source, confidence });
  const changed = JSON.stringify(before) !== JSON.stringify(next);
  if (changed) appendEvent({
    type:'actor.presence.changed',
    source,
    actor_id:actorId,
    target_id:location,
    payload:{ before, after:next },
  });
  return { ...next, actor_id:actorId };
}

function syncIdentityFromContext(identity, context) {
  if (!identity?.id || !actors[identity.id] || !context) return null;
  const usable = Boolean(context.current_location && ['resolved','manual'].includes(context.current_location_status) && context.current_location_confidence >= 0.6);
  if (!usable) return null;
  return setActorPresence(identity.id, {
    present:true,
    location:context.current_location,
    source:context.current_location_source || 'context_engine',
    confidence:context.current_location_confidence,
  });
}

function resetContextGraph() { return { actors:resetActorStates() }; }

function actorDynamicNode(actorId, dynamic) {
  const base = actors[actorId];
  return {
    ...base,
    kind:'identity',
    present:dynamic.present,
    location:dynamic.location,
    location_name:dynamic.location ? spaces[dynamic.location]?.name || dynamic.location : null,
    context_source:dynamic.source,
    context_confidence:dynamic.confidence,
    context_updated_at:dynamic.updated_at,
  };
}
function deviceStateNode(device, entry) {
  return {
    id:`state:${device.id}`,
    kind:'device_state',
    name:`${device.name} 상태`,
    device_id:device.id,
    state:clone(entry?.state || device.state || {}),
    state_updated_at:entry?.updated_at || null,
    state_source:entry?.source || 'runtime',
  };
}

function buildContextGraph() {
  const staticGraph = publicDeviceGraph();
  const realityGraph = publicRealityGraph();
  const state = getStateStore();
  const staticNodes = staticGraph.nodes.filter((n)=>n.kind !== 'identity');
  const actorNodes = Object.keys(actors).map((id)=>actorDynamicNode(id, state.actors[id]));
  const stateNodes = Object.values(devices).map((device)=>deviceStateNode(device, state.devices[device.id]));
  const dynamicEdges = [];

  for (const actorId of Object.keys(actors)) {
    const d = state.actors[actorId];
    if (d.present && d.location) {
      dynamicEdges.push({ from:actorId, to:d.location, type:'located_in', dynamic:true, confidence:d.confidence, source:d.source });
      dynamicEdges.push({ from:d.location, to:actorId, type:'occupied_by', dynamic:true, confidence:d.confidence, source:d.source });
    }
  }
  for (const device of Object.values(devices)) dynamicEdges.push({ from:device.id, to:`state:${device.id}`, type:'has_state', dynamic:true });

  const nodes = [...staticNodes, ...actorNodes, ...stateNodes];
  const edges = [...staticGraph.edges, ...dynamicEdges];
  const ids = new Set(nodes.map((n)=>n.id));
  const issues = [];
  for (const edge of edges) {
    if (!ids.has(edge.from)) issues.push(`missing_from:${edge.from}`);
    if (!ids.has(edge.to)) issues.push(`missing_to:${edge.to}`);
  }

  return {
    version:CONTEXT_GRAPH_VERSION,
    device_graph_version:GRAPH_VERSION,
    reality_graph_version:REALITY_GRAPH_VERSION,
    state_store_version:STATE_STORE_VERSION,
    principle:'Compatibility projection: stable Reality Graph topology is joined with current State Store values at read time. Historical events stay outside this graph.',
    projection:true,
    sources:{ reality_graph:realityGraph.version, state_store:STATE_STORE_VERSION },
    validation:{ ok:issues.length === 0, issues, node_count:nodes.length, edge_count:edges.length },
    nodes,
    edges,
    actors:getContextGraphState().actors,
    dynamic_relation_types:['located_in','occupied_by','has_state'],
  };
}

function occupantsOfSpace(spaceId, { excludeActorId = null } = {}) {
  const state = getStateStore();
  return Object.entries(state.actors)
    .filter(([id,d])=>d.present && d.location === spaceId && id !== excludeActorId)
    .map(([id,d])=>({ id, name:actors[id]?.name || id, role:actors[id]?.role || id, confidence:d.confidence, source:d.source, updated_at:d.updated_at }));
}
function actorContext(actorId) {
  const d = getStateStore().actors[actorId];
  if (!d) return null;
  return { ...clone(d), actor_id:actorId, name:actors[actorId]?.name || actorId, role:actors[actorId]?.role || actorId, location_name:d.location ? spaces[d.location]?.name || d.location : null };
}
function actionContext(deviceId, actorId) {
  const graph = publicDeviceGraph();
  const node = graph.nodes.find((n)=>n.id === deviceId && n.kind === 'device');
  if (!node) return null;
  const store = getStateStore();
  const affectedSpaces = node.affected_spaces || [];
  const occupants = affectedSpaces.flatMap((spaceId)=>occupantsOfSpace(spaceId).map((o)=>({ ...o, space_id:spaceId, space_name:spaces[spaceId]?.name || spaceId })));
  const otherOccupants = occupants.filter((o)=>o.id !== actorId);
  return {
    version:CONTEXT_GRAPH_VERSION,
    actor:actorContext(actorId),
    target_device:{ id:deviceId, state:clone(store.devices[deviceId]?.state || {}) },
    affected_spaces:affectedSpaces.map((id)=>({ id, name:spaces[id]?.name || id })),
    occupants,
    other_occupants:otherOccupants,
  };
}
function stableActionPayload(deviceId, actorId) {
  const c = actionContext(deviceId, actorId);
  if (!c) return null;
  return {
    version:CONTEXT_GRAPH_VERSION,
    actor:{ id:c.actor?.actor_id || actorId, present:c.actor?.present || false, location:c.actor?.location || null },
    target_device:{ id:deviceId, state:c.target_device.state },
    affected_spaces:c.affected_spaces.map((s)=>s.id).sort(),
    occupants:c.occupants.map((o)=>({ id:o.id, space_id:o.space_id })).sort((a,b)=>(a.space_id+a.id).localeCompare(b.space_id+b.id)),
  };
}
function contextGraphSnapshotForAction(deviceId, actorId) {
  const payload = stableActionPayload(deviceId, actorId);
  return payload ? { version:CONTEXT_GRAPH_VERSION, device_id:deviceId, actor_id:actorId, fingerprint:JSON.stringify(payload) } : null;
}
function validateContextGraphSnapshot(snapshot) {
  if (!snapshot || snapshot.version !== CONTEXT_GRAPH_VERSION || !snapshot.device_id || !snapshot.actor_id) return false;
  const now = contextGraphSnapshotForAction(snapshot.device_id, snapshot.actor_id);
  return Boolean(now && now.fingerprint === snapshot.fingerprint);
}
function publicContextGraph() { return buildContextGraph(); }

module.exports = {
  CONTEXT_GRAPH_VERSION,
  getContextGraphState,
  setActorPresence,
  syncIdentityFromContext,
  resetContextGraph,
  publicContextGraph,
  occupantsOfSpace,
  actorContext,
  actionContext,
  contextGraphSnapshotForAction,
  validateContextGraphSnapshot,
};
