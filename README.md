# Reality Layer v1.8.2 — External Runtime Test Build

> Third-party integration checkpoint: explicit action outcomes (`SUCCEEDED` / `FAILED` / `UNKNOWN`), reconciliation, stable Typed Action IR IDs, provenance, and a dependency-free LangGraph adapter. v1.8.2 exposes the action contract directly in `reality.execute` and adds MCP action-status/reconciliation tools. See `docs/EXTERNAL-RUNTIME.md`.

# Reality Layer 1.8.2 · Dual-era MCP + External Action Contract

Reality Layer v1.8.2은 v1.7.1의 **Capability Model + Typed Action IR + Reality Graph / State Store / Event Store + Dual-era MCP**를 유지하면서, 외부 AI/Agent가 실행 결과를 안전하게 복구할 수 있도록 **stable action outcome contract와 reconciliation 경로**를 노출합니다.

```text
External AI / Agent
        ↓
MCP 2026-07-28
        ↓
Reality Layer
├─ reality.discover
├─ reality.observe
├─ reality.plan
├─ reality.execute
└─ reality.explain
        ↓
Identity / Context / Capability
Permission / Safety / Stale checks
        ↓
Executor → Adapter → PC / Home / future devices
```

## 1분 안에 시작

1. ZIP을 완전히 압축 해제합니다.
2. Node.js 22 이상에서 `START-DEMO.cmd`를 실행합니다.
3. 브라우저가 열리지 않으면 Microsoft Edge에서 `http://127.0.0.1:3000`을 엽니다.
4. 실제 Windows 앱 제어는 Demo를 종료한 뒤 `START-WINDOWS.cmd`로 실행합니다.

`npm install`은 필요 없습니다. 외부 npm 패키지를 사용하지 않습니다. Windows PowerShell에서 실행 정책 때문에 `npm`이 막히면 `npm.cmd test`, `npm.cmd start`처럼 `npm.cmd`를 사용하세요.

실행 터미널에는 다음도 표시됩니다.

```text
MCP endpoint: http://127.0.0.1:3000/mcp
MCP Bearer token: <매 실행마다 생성되는 비밀 토큰>
```

환경변수 `REALITY_MCP_TOKEN`을 직접 설정하면 고정 토큰을 사용할 수 있습니다. 토큰은 외부 Agent 연결용 비밀값이므로 공유하거나 저장소에 커밋하지 마세요.

## MCP Tools

### `reality.discover`

Reality Graph, Device, Capability Model, 현재 정책 Identity와 Northbound 스펙을 읽습니다. 실제 행동은 수행하지 않습니다.

### `reality.observe`

State Store, Context, Context Graph, 최근 Event Store 기록을 읽습니다. `device_id`로 특정 기기만 볼 수도 있습니다.

### `reality.plan`

자연어를 실행 가능한 Reality plan으로 컴파일합니다.

```text
"침실 불 켜줘"
        ↓
Direct plan
        ↓
Typed Action IR
        ↓
Policy / Safety
        ↓
plan_id
```

기존 Orchestrator가 지원하는 `공부 시작할게`, `나 이제 나갈게`, `나 잘게` 같은 복합 의도도 그대로 사용합니다.

### `reality.execute`

반드시 기존 `plan_id`만 실행합니다. 외부 Agent가 임의의 Device/Capability를 직접 집어넣어 Executor를 우회하는 인터페이스는 제공하지 않습니다.

특히 **외부 MCP Agent는 `CONFIRM` 행동을 스스로 승인할 수 없습니다.**

```text
AUTO plan
→ MCP execute 가능

CONFIRM plan
→ 사용자 확인 필요
→ 외부 Agent 실행 중단
```

`confirmed:true` 같은 필드를 MCP Agent가 임의로 보내는 것도 Tool schema에서 허용하지 않습니다. 실제 확인이 필요한 행동은 신뢰된 로컬 UI 흐름을 통해 사용자가 직접 승인해야 합니다.

AUTO 실행 성공 시 `reality.execute`는 결과의 최상위에 `action`(단일 행동)과 `actions`(모든 행동)를 반환합니다. 각 항목에는 `action_id`, `outcome`, `provenance`, `evidence`, `reconciliation`이 포함됩니다. `UNKNOWN`이면 `reconciliation.required=true`이며, blind retry를 하지 않는 것이 계약입니다.

### `reality.explain`

대기 중인 계획의 Policy/Safety 판단이나 실행 후 로그·Event Store 감사 기록을 조회합니다.

### `reality.action.get`

`action_id`로 `STARTED / SUCCEEDED / FAILED / UNKNOWN`, provenance, evidence, reconciliation 필요 여부를 읽습니다.

### `reality.action.reconcile`

외부 검증용 primitive입니다. `UNKNOWN`만 명시적 evidence와 함께 `SUCCEEDED` 또는 `FAILED`로 확정합니다. **재실행하지 않습니다.**

## MCP 전송/보안 모델

v1.7은 **MCP 2026-07-28 modern stateless lifecycle**을 대상으로 합니다.

- Endpoint: `POST /mcp`
- JSON-RPC 2.0
- `MCP-Protocol-Version: 2026-07-28`
- `Mcp-Method` 검증
- `tools/call`에서는 `Mcp-Name`도 body와 일치해야 함
- `Authorization: Bearer <MCP token>` 필요
- localhost (`127.0.0.1`) 전용
- `clientInfo`는 감사/표시용 self-reported metadata일 뿐 권한 부여에 사용하지 않음

현재 v1.7은 2026 modern lifecycle에 집중하며, 2025 계열 `initialize`/session 호환 모드는 구현하지 않습니다.

## 중요한 보안 원칙

```text
External Agent
      ↓
MCP
      ↓
Plan handle
      ↓
Identity
      ↓
Reality Graph / State / Context
      ↓
Permission + Safety
      ↓
Stale-world validation
      ↓
Executor
```

외부 Agent가 Adapter, Windows 실행기, Home Assistant Adapter를 직접 호출하는 MCP Tool은 없습니다.

MCP의 `clientInfo.name = "owner"`처럼 이름을 속여도 Reality Identity가 바뀌지 않습니다. 현재 Human Identity는 기존 Reality Layer Identity 시스템이 결정하고, MCP client metadata는 `self-reported-unverified`로 Audit Event에 기록합니다.

## v1.6 구조도 그대로 유지

```text
Reality Graph = 비교적 안정적인 엔티티/관계
State Store   = 현재 알려진 mutable state
Event Store   = 시간순 history
```

Context Graph는 Reality Graph + State Store의 compatibility projection입니다.

개발 확인 API:

```text
GET /api/reality-graph
GET /api/state-store
GET /api/event-store
GET /api/context-graph
GET /api/capability-model
GET /api/action-ir
GET /api/mcp-status
```

## Windows 실제 실행

`START-WINDOWS.cmd`에서는 기존 allowlist 기반 Windows Adapter를 그대로 사용합니다.

지원 예시:

```text
계산기 켜줘
유튜브에서 상대성이론 검색해줘
VS Code 켜줘
다운로드 폴더 열어줘
```

AI에게 임의 `cmd`, PowerShell, arbitrary shell 실행 기능을 제공하지 않습니다.

## 음성 입력

현재 음성은 기존 push-to-talk 방식 그대로 유지됩니다.

```text
Voice → Text → Intent/Plan → Policy/Safety → Execution
```

Wake Word는 아직 구현하지 않았습니다.

## 로컬 데이터

런타임 JSON은 `data/*.json`에 생성되고 Git에서 제외됩니다. 배포 ZIP에는 실제 사용 중 생성된 상태·이벤트·로그를 포함하지 않습니다.

## 테스트

```text
npm test
```

v1.7 기준:

```text
기존 Core / Policy / Windows 회귀
Everyday 통합                     19
v1.5 Capability / Action IR        8
v1.6 Graph / State / Event         8
v1.7 MCP 신규                      9
-------------------------------------
전체 PASS                          94
```

v1.7 신규 테스트는 Bearer 인증, `server/discover`, `tools/list`, 표준 헤더 일치 검사, discover/observe, direct natural-language plan, AUTO 실행, Agent self-confirm 차단, clientInfo 비신뢰 처리, explain/audit를 검증합니다.

세부 문서: `docs/V1.7.md`, `docs/ARCHITECTURE.md`, `docs/VERIFICATION.md`

## 기준 로드맵

```text
v1.5  Capability Model + Typed Action IR          ✅
v1.6  Reality Graph / State / Event 분리          ✅
v1.7  Northbound MCP Server                       ✅ 현재
v1.8  Protocol Connector + MCP/WoT importer       다음
v1.9  retry / idempotency / compensation
v2.0  Local Reality Runtime 아키텍처 고정
```


## v1.7.1 MCP compatibility

The `/mcp` endpoint supports both the 2026-07-28 modern flow and 2025-era initialize/session MCP clients such as Gemini CLI using MCP SDK 1.x.
