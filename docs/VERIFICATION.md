# Reality Layer v1.8.1 검증 결과 — 2026-09-22

필수 런타임은 Node.js 22 이상입니다. 전체 자동 회귀 스위트는 격리된 임시 복사본에서 실행되어 실제 사용 중인 `data/`를 초기화하지 않습니다.

## 전체 자동 테스트

```text
Core / Policy / Windows regression        PASS
Everyday integration                      PASS (19)
v1.5 Capability / Typed Action IR         PASS (8)
v1.6 Reality Graph / State / Event        PASS (8)
v1.7 Northbound MCP                       PASS (9)
v1.7.1 Legacy MCP compatibility           PASS (5)
v1.8 Action ledger / UNKNOWN recovery     PASS
v1.8.1 External action contract           PASS
```

실행 명령:

```text
npm test
```

## v1.8.1 외부 Agent smoke test

2026-09-22 Windows PowerShell + Node v24.21.0 환경에서 `examples/langgraph-smoke.js`를 실제 서버에 연결해 다음을 확인했습니다.

```text
External client
→ MCP Bearer auth
→ reality.plan("침실 불 켜줘")
→ decision=AUTO
→ reality.execute(plan_id)
→ stable action_id
→ outcome=SUCCEEDED
→ provenance includes plan_id + actor_id
→ reconciliation.required=false
→ HTTP 200
```

실제 출력의 최종 계약 형태:

```text
ACTION <stable-action-id>: SUCCEEDED / reconciliation=NOT_REQUIRED
```

이 테스트는 안전한 virtual bedroom-light adapter를 사용하며, 외부 Agent가 Runtime contract를 검증할 수 있는 경로를 확인하는 것이 목적입니다.

## v1.7 / v1.7.1 MCP

- `/mcp` Bearer token 없는 접근 차단
- modern `server/discover` / `tools/list`에서 `2026-07-28` flow 지원
- 2025-11-25 계열 `initialize` / session compatibility 지원
- `Mcp-Method` / `Mcp-Name`과 JSON-RPC body 불일치 차단
- `reality.discover` / `reality.observe` read path 검증
- `reality.plan` → Typed Action IR plan → AUTO execution 검증
- CONFIRM plan은 외부 Agent가 자기 승인할 수 없음
- MCP `clientInfo`는 `self-reported-unverified` audit metadata이며 Reality Identity를 변경하지 않음
- `reality.explain` 실행/audit 조회 검증

## v1.8 / v1.8.1 action contract

- Typed Action IR stable `action_id`가 executor / ledger / external result까지 유지됨
- terminal outcome: `SUCCEEDED`, `FAILED`
- uncertain outcome: `UNKNOWN`
- `UNKNOWN`은 blind retry하지 않고 evidence 기반 reconciliation을 먼저 수행
- `reality.action.get`으로 현재 action outcome/provenance/evidence 조회
- `reality.action.reconcile`은 물리 행동을 재실행하지 않고 `UNKNOWN`만 `SUCCEEDED`/`FAILED`로 확정
- `reality.execute`가 `action`, `actions`, `reconciliation_required`를 외부에 직접 노출
- dependency-free LangGraph adapter가 plan / execute / observe / discover / explain / actionStatus / reconcile 제공

## 패키지/보안 확인

- 외부 npm dependency 없음
- 서버는 기본적으로 `127.0.0.1`에만 bind
- `.env`, `config.local.json`, `apps.local.json`은 배포본에서 제외
- runtime `data/*.json`은 Git에서 제외하고 `data/.gitkeep`만 유지
- MCP token은 저장소에 커밋하지 않음
- 외부 Agent가 Adapter/Windows shell을 직접 호출하는 northbound tool은 제공하지 않음
- Owner/Family/Guest Identity는 현재 정책 시뮬레이션용이며 실제 인증을 의미하지 않음

## 아직 외부 검증이 필요한 부분

- 제3자 LangGraph/CrewAI 등의 실제 staging/non-production agent에서의 integration breakpoints
- graph checkpoint/durability와 stable action identity의 충돌 여부
- agent retry semantics와 `UNKNOWN` reconciliation 경계
- 실제 Home Assistant 등 물리 adapter별 readback/evidence binding
- production-grade human/device authentication

이 빌드는 **third-party integration checkpoint**이며 production readiness를 주장하지 않습니다.
