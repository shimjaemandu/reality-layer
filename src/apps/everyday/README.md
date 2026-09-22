# Everyday application layer

Everyday는 Reality Layer Core 자체가 아니라 **Core 위에서 동작하는 첫 응용 앱**입니다.

- `planner.js`: 공부/휴식/귀가/취침/외출 같은 사용자 경험을 Core의 action plan으로 변환합니다.
- `store.js`: Everyday 전용 개인 설정과 활동 세션을 로컬 `data/`에 저장합니다.
- 권한·Context Graph·Device Graph·UAG·Adapter는 상위 `src/` Core 모듈을 그대로 사용합니다.

새로운 Building/Robot/Vehicle 응용을 추가할 때 Everyday 로직을 Core에 복사하지 않고 별도 application module로 추가하는 것을 원칙으로 합니다.
