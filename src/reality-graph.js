'use strict';
const {
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
} = require('./device-graph');

const REALITY_GRAPH_VERSION = 'reality-graph/1.6';

function publicRealityGraph() {
  const legacy = publicDeviceGraph();
  return {
    version: REALITY_GRAPH_VERSION,
    source_graph_version: legacy.version,
    layer: 'topology',
    principle: 'Reality Graph stores relatively stable entities and relationships only. Live values belong to State Store and historical changes belong to Event Store.',
    validation: legacy.validation,
    nodes: legacy.nodes.map((node) => ({ ...node })),
    edges: legacy.edges.map((edge) => ({ ...edge })),
    separation: {
      contains_live_device_state: false,
      contains_actor_presence: false,
      contains_event_history: false,
      current_state_api: '/api/state-store',
      event_history_api: '/api/event-store',
    },
    legend: legacy.legend,
  };
}

function validateRealityGraph() {
  const result = validateGraph();
  const graph = publicRealityGraph();
  const dynamicKinds = graph.nodes.filter((node) => node.kind === 'device_state');
  const dynamicEdges = graph.edges.filter((edge) => ['occupied_by', 'has_state'].includes(edge.type) || edge.dynamic === true);
  const issues = [...result.issues];
  if (dynamicKinds.length) issues.push('live_state_node_in_reality_graph');
  if (dynamicEdges.length) issues.push('dynamic_edge_in_reality_graph');
  return { ...result, ok: issues.length === 0, issues };
}

module.exports = {
  REALITY_GRAPH_VERSION,
  spaces,
  actors,
  infrastructure,
  devicePolicies,
  deviceNode,
  publicRealityGraph,
  validateRealityGraph,
  getRealityGraphContext: getDeviceGraphContext,
  realityGraphSnapshotForDevice: graphSnapshotForDevice,
  validateRealityGraphSnapshot: validateGraphSnapshot,
};
