# MapKeeper Frontend TASK

> 담당: 프론트엔드
> 상태: **Canonical / current implementation mapped**
> 기준 커밋: `206ad82198aa8c76652f3001ee6bd31d24cd360d`

## 1. 완료된 계약·공통 작업

| ID | 작업 | 상태 | 완료 기준 |
|---|---|---|---|
| T205 | API 상태와 도메인 상태 분리 | Done | PARTIAL_SUCCESS는 SyncJob에만 존재 |
| T207 | UC1 변경값 변환 | Done with gap | API 경계 구조화, UI 내부 문자열 표현 사용 |
| T209 | UC2 Generation 전체 계약 | Done | create·regenerate·reject·approve |
| T211 | MSW fixture·handler | Done | 실제 Endpoint 형태 사용 |
| T240 | 실제 backend 연결 | Done with gap | 수동 타입·unchecked generic cast 보완 필요 |

## 2. UC1

| 작업 | 상태 |
|---|---|
| Web Speech IDLE·LISTENING·RECOGNIZED·FAILED | Done |
| 음성 실패 시 텍스트 fallback | Done |
| 변경안 검토·편집 | Done |
| 서버 reject 호출과 REJECTED 화면 | Done |
| approve와 Idempotency-Key | Done |
| 승인 변경값만 결과 화면에 표시 | Done |
| 동일 값 변경 거절 안내 | Done |
| 여러 대표 메뉴 후보 거절 | Done |

## 3. UC2

| 작업 | 상태 |
|---|---|
| 홈·UC2 리뷰 요약 공유 | Done |
| INTRODUCTION·NEWS 선택 | Done |
| 목적별 인터뷰 질문 | Done |
| 빠른 시작 버튼 | Done |
| 음성·텍스트 답변 | Done |
| 답변 수정 | Done |
| NEWS 기간 추출·달력 확인 | Done |
| 3사 draftText·keywords·contentRules 표시 | Done |
| Generation 전체 재생성 | Done |
| Generation 전체 거절 | Done |
| Generation 전체 승인, draftIds 없음 | Done |
| 실제 FastAPI UC1·UC2 계약 회귀 | Implemented / PR CI pending |
| 내부 status를 사용자 문구로 변환 | Done |

현재 제품은 `briefText`와 `seedKeywords`를 별도 폼에서 직접 편집하지 않는다. 인터뷰 답변과 리뷰 요약에서 구성하는 방식이 최신 기준이다.

## 4. SyncJob 상태 화면

| 작업 | 상태 |
|---|---|
| 플랫폼별 상태·오류·attemptCount 표시 | Done |
| retryable 플랫폼만 재시도 표시 | Done |
| 성공 플랫폼 결과 보존 | Done |
| 화면 이탈 시 AbortController 취소 | Done |
| 기본 2초 Polling | **Planned** |
| 최대 60초 후 중단 | **Planned** |
| 지연 안내·다시 확인 버튼 | **Planned** |

현재 `SyncStatusDashboard` 기본값은 500ms이고 UC1·UC2 화면은 100ms를 전달하며 무기한 반복한다. T252에서 수정한다.

## 5. 계약 자동화 과제

현재 `apiRequest<T>`는 Envelope를 얕게 확인한 뒤 `payload.data as T`로 처리한다. 다음을 보완한다.

1. OpenAPI에서 TypeScript 타입과 런타임 schema를 생성하거나 동일한 Zod schema를 유지한다.
2. UC1 structured response를 UI 표현 타입과 명확히 분리한다.
3. Proposal 승인 응답의 `proposalStatus`, `status`를 타입에 포함한다.
4. Retry 응답의 `status`, `statusUrl`을 타입에 포함한다.
5. 알 수 없는 응답 필드·Enum·손상된 data를 API 경계에서 거절한다.

## 6. 검증 명령

```bash
cd workspace/frontend
npm run lint
npm run typecheck
npm run test:run
npm run build
```

현재 기준: 18 files, 110 tests passed.

## 7. 남은 우선순위

| 우선순위 | 작업 |
|---:|---|
| P0 | 2초·60초 Polling과 다시 확인 UX |
| P1 | OpenAPI 기반 응답 런타임 검증 |
| P1 | 네트워크 오류·지연 수동 QA |
| P2 | URL 기반 화면 이동·새로고침 복구 검토 |
