# Reality Layer 1.7 Architecture

```text
Northbound
├─ Local UI / Voice / Everyday
└─ MCP 2026-07-28
   ├─ reality.discover
   ├─ reality.observe
   ├─ reality.plan
   ├─ reality.execute
   └─ reality.explain

Intent / Planning
├─ Intent Interpreter
└─ Planner / Orchestrator

Reality Core
├─ Identity
├─ Capability Model
├─ Typed Action IR
├─ Reality Graph      ← stable topology
├─ State Store        ← current mutable values
├─ Event Store        ← ordered history
├─ Context Projection
├─ Permission
└─ Safety

Execution
├─ Executor
├─ UAG/0.1 compatibility bridge
└─ Adapters
   ├─ Windows
   ├─ Home Assistant Light
   └─ Virtual devices
```

## Truth ownership

Reality Graph owns **relationships**, State Store owns **latest values**, Event Store owns **ordered historical events**. Context Graph is derived from Reality Graph + State Store.

## Northbound boundary

External agents never receive direct Adapter handles. MCP exposes Reality-level operations, not device-driver APIs.

```text
MCP Agent
  ↓
plan
  ↓
Typed Action IR
  ↓
Permission / Safety
  ↓
execute
```

`reality.execute` accepts a plan handle, not arbitrary device commands.

## Identity boundary

MCP client identity and Reality policy identity are separate concepts.

```text
MCP clientInfo
= unverified caller metadata

Reality Identity
= policy principal used for authorization
```

v1.7 intentionally does not promote self-reported clientInfo to authorization state.

## Stale action safety

Pending actions/plans preserve topology/context snapshots. Reality Layer rebuilds the relevant current view before execution and rejects a stale plan if the world changed.

## Local interfaces

```text
POST /mcp
GET  /api/mcp-status
GET  /api/reality-graph
GET  /api/state-store
GET  /api/event-store
GET  /api/context-graph
GET  /api/capability-model
GET  /api/action-ir
```

The server binds to loopback only. MCP additionally requires a Bearer token.
