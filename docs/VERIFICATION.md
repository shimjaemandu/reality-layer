# Reality Layer v1.7 검증 결과 — 2026-09-19

필수 런타임은 Node.js 22 이상입니다. 자동 검증은 Linux 기반 격리 환경에서 수행했으며, Windows 실기기 동작은 기존 v1.6 단계에서 사용자 노트북으로 별도 확인되었습니다.

## 전체 자동 테스트

```text
Core / Policy / Windows regression       50 PASS
Everyday integration                     19 PASS
v1.5 Capability / Typed Action IR         8 PASS
v1.6 Reality Graph / State / Event        8 PASS
v1.7 Northbound MCP                       9 PASS
------------------------------------------------
TOTAL                                     94 PASS
```

`npm test`는 임시 복사본에서 실행되어 실제 사용 중인 `data/`를 초기화하지 않습니다.

## v1.5

- Device type별 Capability Model 검증
- Capability input type/range 검증
- legacy UAG ↔ semantic capability bridge 검증
- Typed Action IR target/capability/operation/provenance 검증
- Executor가 Action IR을 검증한 뒤 Adapter bridge를 사용하는지 검증
- Orchestrator step에 Action IR이 포함되는지 검증

## v1.6

- Reality Graph가 topology만 소유하고 live device state/dynamic occupancy를 포함하지 않는지 검증
- State Store가 Actor/Device/Sensor current value를 별도 소유하는지 검증
- Actor 위치 변경이 State Store에만 반영되는지 검증
- Context Graph가 Reality Graph + State Store projection인지 검증
- Executor 성공 후 State Store 최신값과 `device.action.executed` Event가 함께 기록되는지 검증
- Event sequence ordering 검증
- `/api/reality-graph`, `/api/state-store`, `/api/event-store` 분리 응답 검증

## v1.7 MCP

- `/mcp` Bearer token 없는 접근 차단
- `server/discover`에서 `2026-07-28` 지원 광고
- `tools/list`에 5개 Reality Tool 노출
- `Mcp-Method` / `Mcp-Name`과 JSON-RPC body 불일치 차단
- `reality.discover` / `reality.observe` read path 검증
- 직접 자연어 → Typed Action IR plan → AUTO execution 검증
- CONFIRM plan은 외부 Agent가 실행하거나 자기승인할 수 없음을 검증
- MCP `clientInfo`는 `self-reported-unverified` audit metadata이며 Reality Identity를 변경하지 않음을 검증
- `reality.explain`이 실행 로그 또는 audit event를 반환하는지 검증

## 배포 스모크 테스트

실제 `launch.js --no-open`으로 서버를 기동한 뒤 다음을 확인했습니다.

```text
GET  /api/mcp-status     → HTTP 200
POST /mcp server/discover → supportedVersions = ["2026-07-28"]
POST /mcp tools/list      → 5 tools
```

실행 터미널에 MCP endpoint와 runtime Bearer token이 표시됩니다.

## 문법/패키지 검증

- 프로젝트 전체 JavaScript `node --check` 통과
- 외부 npm dependency 없음
- 서버는 기본적으로 `127.0.0.1`에만 bind
- `.env`, `config.local.json`, `apps.local.json`은 배포본에 포함하지 않음
- 테스트/스모크 과정에서 생성된 `data/*.json`은 최종 ZIP에서 제거하고 `data/.gitkeep`만 유지

## 아직 실제 환경에서 별도 검증이 필요한 부분

- 특정 외부 MCP Host/Agent 제품과의 end-to-end 연결
- 실제 Home Assistant 계정/조명
- 브라우저 SpeechRecognition 서비스 품질
- 향후 실사용 인증 체계. 현재 Owner/Family/Guest는 정책 시뮬레이션 Identity이며 real-world authentication이 아님

v1.7은 MCP 2026 modern lifecycle에 집중합니다. 2025 계열 `initialize`/session 호환은 현재 범위 밖입니다.
