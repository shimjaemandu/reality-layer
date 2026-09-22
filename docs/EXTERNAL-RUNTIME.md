# Reality Layer v1.8.1 — external runtime contract

This build is intentionally small. It is for third-party agent integration tests, not a claim of production readiness.

## Contract under test

`Agent -> northbound adapter/MCP -> Reality Layer policy + safety -> executor -> device adapter`

Each Typed Action IR has a stable `id` and retains provenance including source text, intent, plan id and actor id. The executor records one explicit action outcome independently of the agent graph:

- `SUCCEEDED`: adapter returned and Reality Layer synchronized current/observed state.
- `FAILED`: execution failed with a known failure before/at the adapter boundary.
- `UNKNOWN`: the runtime cannot safely prove whether the side effect happened. **Do not blindly retry. Reconcile first.**

`UNKNOWN` may only reconcile to `SUCCEEDED` or `FAILED`. Terminal outcomes are not silently rewritten.

`reality.execute` exposes this contract directly:

```json
{
  "status": "completed",
  "action": {
    "action_id": "...",
    "outcome": "SUCCEEDED",
    "provenance": {"plan_id":"..."},
    "reconciliation": {"required": false, "state": "NOT_REQUIRED"}
  },
  "actions": ["...same shape for each executed step..."],
  "reconciliation_required": false
}
```

## LangGraph adapter

`integrations/langgraph/reality-layer-adapter.js` is dependency-free on purpose. It talks to Reality Layer's MCP endpoint and can be wrapped by LangChain/LangGraph's current `tool()` helper without coupling this runtime to a specific LangGraph release.

Methods: `plan`, `execute`, `observe`, `discover`, `explain`, `actionStatus`, `reconcile`.

## Five-minute smoke test (Windows PowerShell)

1. `npm.cmd test`
2. Start safe virtual mode: `npm.cmd start -- --no-open`
3. Copy the MCP Bearer token printed in that terminal.
4. In a second terminal: `$env:REALITY_MCP_TOKEN="<token>"`
5. Run: `npm.cmd run example:langgraph`

The example uses a safe virtual `침실 불 켜줘` AUTO action and prints the full nested JSON so `action_id`, `outcome`, provenance and reconciliation state are visible.

## UNKNOWN recovery test primitive

Read: `reality.action.get({action_id})`

Resolve: `reality.action.reconcile({action_id, outcome:"SUCCEEDED"|"FAILED", evidence_note:"..."})`

Reconciliation never retries the physical action. This external-test primitive expects evidence from a trustworthy readback, transaction receipt or equivalent source. A production design should bind reconciliation evidence to a trusted adapter/readback source rather than accept a generic assertion.

## Feedback wanted

Please report where this contract conflicts with graph durability/checkpointing, retry semantics, tool-call identity, or recovery after an UNKNOWN outcome. A minimal reproduction is more useful than broad architecture feedback.
