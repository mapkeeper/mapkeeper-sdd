# MapKeeper 개발 원칙

> 문서 역할: 모든 제품·설계·구현 판단의 최상위 기준
> 상태: **Canonical / 최신 코드 대조 완료, 알려진 구현 격차 존재**
> 기준 코드: `2026-08-17 current working tree` (base `12687c2ed099cc6369d45b59791fa3ca62ea106d`)
> 최종 대조일: `2026-08-17`
> 담당: PM 승인, 프론트엔드·백엔드 공동 준수

## 1. 단일 기준과 변경 순서

1. GitHub의 `docs/sdd/`를 최신 설계 문서의 단일 기준으로 사용한다.
2. Docmost는 회의·초안·논의 기록에 사용하고, 확정 내용은 이 디렉터리에 반영한다.
3. 문서가 충돌하면 다음 순서로 판단한다.

   `Constitution → Specify → API Contract → Data Model → Plan → Tasks`

4. `research.md`는 결정 배경을 설명하는 참고 문서이며 상위 계약을 변경하지 않는다.
5. 요구사항·API·데이터 모델 변경은 구현보다 먼저 확정하거나 같은 PR에 포함한다.
6. 상위 문서에 없는 Endpoint·필드·Enum을 코드에 먼저 추가하지 않는다.
7. 코드와 문서가 충돌하면 임의로 한쪽을 따르지 않고 변경 의도를 확인한 뒤 같은 PR에서 정리한다.

## 2. MVP 범위

MapKeeper MVP는 다음 두 유스케이스를 모두 포함한다.

### UC1. 음성으로 매장 정보 변경

- 브라우저 Web Speech API로 음성을 텍스트로 변환한다.
- 원본 오디오는 서버로 전송하거나 저장하지 않는다.
- 변경 가능 필드는 영업시간, 임시 휴무, 대표 메뉴다.
- 시스템은 구조화된 변경안을 만들고 사용자가 검토·수정·거절·승인한다.
- 명시적 승인 전에는 StoreProfile이나 외부 플랫폼을 변경하지 않는다.

### UC2. 리뷰 기반 홍보 콘텐츠 생성

- 사용자는 `INTRODUCTION` 또는 `NEWS` 목적을 선택한다.
- 현재 UI는 인터뷰 답변을 `briefText`로 구성하고 리뷰 요약 키워드를 `seedKeywords`로 사용한다.
- Google·Naver·Kakao별 문구와 키워드를 각각 하나씩 생성한다.
- 플랫폼 결과는 개별 선택하지 않고 `ContentGeneration` 전체를 재생성·거절·승인한다.
- 승인 요청에 `draftIds`를 사용하지 않는다.
- `NEWS`는 행사·할인·신메뉴·휴무 안내 같은 소식에 맞는 질문과 기간 확인 흐름을 사용한다.

### 지원 기능. 리뷰 요약

- 홈과 UC2 화면은 같은 리뷰 요약 응답을 사용한다.
- 전체 리뷰 수와 대표 마스킹 리뷰 최대 10건을 제공한다.
- 데모 seed는 StoreProfile 1건과 마스킹 리뷰 128건을 제공한다.
- 감정 분석 모델, 리뷰 답변 자동 게시, DS 전용 모델은 MVP에서 제외한다.

## 3. 승인과 외부 반영

1. UC1과 UC2 모두 사용자의 명시적 승인 후 `SyncJob`을 생성한다.
2. UC2 승인 단위는 개별 Draft가 아니라 Generation 전체다.
3. 승인 트랜잭션은 승인 대상, SyncJob, Google·Naver·Kakao Task 세 개를 원자적으로 저장한다.
4. DB commit 전에는 플랫폼 어댑터를 호출하지 않는다.
5. 승인 API는 `Idempotency-Key`를 요구한다.
6. `approvedBy`는 요청에서 받지 않고 서버의 `MVP_ACTOR_ID`를 사용한다.
7. 현재 Google·Naver·Kakao 발행 어댑터는 외부 호출 없이 성공을 재현하는 시뮬레이션 구현이다.
8. 내부 문서와 보고서에서는 파이프라인 검증과 실제 운영 API 연동 검증을 구분한다.

## 4. 상태 모델

### 최상위 API 상태

`SUCCESS`, `PROCESSING`, `FAILED`

### Proposal과 Generation

`DRAFT`, `APPROVED`, `REJECTED`

### SyncJob

`PENDING`, `PROCESSING`, `PARTIAL_SUCCESS`, `SUCCESS`, `FAILED`, `RETRYING`

### PlatformSyncTask

`PENDING`, `PROCESSING`, `SUCCESS`, `FAILED`, `RETRYING`

`PARTIAL_SUCCESS`는 SyncJob에만 사용한다. 플랫폼 Task에는 사용하지 않는다.

## 5. 비동기 처리와 재시도

1. MVP는 FastAPI `BackgroundTasks`와 PostgreSQL 상태 저장을 사용한다.
2. 성공한 플랫폼은 재시도하지 않는다.
3. timeout, HTTP 429, HTTP 5xx만 최대 3회 재시도한다.
4. 재시도는 지수 백오프를 실제 실행 시점에 적용해야 한다.
5. 프론트엔드는 기본 2초 간격으로 상태를 조회하고 최대 60초 후 자동 Polling을 중단한다.
6. 60초가 지나도 서버 작업은 취소하지 않으며 사용자가 다시 확인할 수 있어야 한다.
7. 프로세스 재시작 시 `PROCESSING`·`RETRYING` 작업은 안전한 실패 상태로 복구한다.

> 현재 격차: 프론트 Polling은 100~500ms 무기한 반복이며, 백엔드는 `nextRetryAt`을 저장하지만 실제 대기 없이 재실행한다. 두 항목은 구현 완료로 간주하지 않는다.

## 6. 보안과 개인정보

1. 고객 이름·전화번호·상세 주소·식별자는 외부 경계에 도달하기 전에 마스킹한다.
2. 마스킹 전 고객 PII는 로그·DB·응답·Gemini 요청에 남기지 않는다.
3. 공개 매장명·공개 주소·영업시간·대표번호는 승인된 비즈니스 정보로 사용할 수 있다.
4. OAuth Token, Client Secret, API Key는 환경변수 또는 별도 보안 저장소에서 관리한다.
5. 프론트엔드는 Secret을 보관하거나 전송하지 않는다.
6. `X-Request-ID`는 기록하되 민감 입력과 `Idempotency-Key` 전체 값은 기록하지 않는다.

> 현재 격차: 결정적 마스커가 고객 식별자와 접두어 없는 이름·상세 주소를 모두 포괄하지 못한다. 보안 원칙을 축소하지 않고 구현을 강화한다.

## 7. 계약과 데이터 무결성

1. 기계 판독 가능한 API 기준은 `workspace/backend/openapi.json`이다.
2. `api-contract.md`는 OpenAPI의 사람이 읽는 설명과 제품 규칙을 담당한다.
3. JSON은 camelCase, ID는 UUID, 시각은 UTC ISO 8601을 사용한다.
4. 요청 경계에서 스키마를 파싱하고 내부 로직은 검증된 타입만 사용한다.
5. 프론트엔드와 백엔드는 같은 Endpoint·Enum·필드 정의를 사용해야 한다.
6. Migration과 ORM 모델은 `data-model.md`와 일치해야 한다.
7. MVP 임시 휴무는 시작일·종료일 한 기간으로 저장한다.
8. 플랫폼별 생성 결과에는 개별 승인 상태를 두지 않는다.

## 8. 검증과 완료 기준

1. 코드 존재, 자동 테스트, 통합 테스트, 배포 검증, 실제 외부 연동을 별도 상태로 기록한다.
2. 구현하지 않았거나 실행하지 않은 항목은 `Planned` 또는 `Not yet verified`로 표시한다.
3. 테스트 수·커버리지·배포 상태에는 검증 커밋과 날짜를 함께 기록한다.
4. DB가 필요한 검증은 실제 PostgreSQL에서 실행해야 완료로 인정한다.
5. 외부 플랫폼 시뮬레이션 성공을 실제 운영 API 검증으로 주장하지 않는다.
6. 주요 변경은 브랜치와 PR에서 문서·코드·테스트를 함께 검토한다.
