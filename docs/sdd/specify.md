# MapKeeper 기능 명세

> 상태: **Canonical / current implementation aligned with known gaps**
> 기준 코드: `2026-08-17 current working tree` (base `12687c2ed099cc6369d45b59791fa3ca62ea106d`)
> 최종 대조일: `2026-08-17`
> 담당: PM

## 1. 제품 목표

디지털 채널 관리에 익숙하지 않은 소상공인이 음성과 간단한 인터뷰만으로 매장 정보를 수정하고 Google·Naver·Kakao용 홍보 콘텐츠를 만들 수 있게 한다.

## 2. 사용자와 전제

- 핵심 사용자는 모바일 입력과 긴 설정 화면에 부담을 느끼는 소상공인이다.
- MVP에는 로그인 기능이 없으며 하나의 고정 `MVP_ACTOR_ID`를 사용한다.
- Google·Naver·Kakao API는 정상 동작한다고 가정하고 내부 파이프라인을 검증한다.
- 실제 외부 발행과 시뮬레이션 발행은 검증 기록에서 구분한다.

## 3. UC1: 음성으로 매장 정보 변경

### 기본 흐름

1. 사용자가 영업시간·임시 휴무·대표 메뉴 변경을 말하거나 텍스트로 입력한다.
2. 브라우저가 음성을 텍스트로 변환한다.
3. 서버가 고객 PII를 마스킹한다.
4. 결정적 파서와 선택적 Gemini 구조화기가 허용 필드의 변경안을 생성한다.
5. 사용자가 변경 전·후 값을 확인한다.
6. 사용자는 내용을 수정하거나 변경안 전체를 거절할 수 있다.
7. 명시적 승인 시 SyncJob과 플랫폼 Task 세 개를 생성한다.
8. 화면은 플랫폼별 처리 상태와 실제 승인 변경값만 보여준다.

### 허용 필드

| 필드 | 값 |
|---|---|
| `businessHours` | `{open: HH:mm, close: HH:mm}` |
| `temporaryClosure` | `{startDate: YYYY-MM-DD, endDate: YYYY-MM-DD}` |
| `representativeMenuName` | 1~50자 문자열 |

### 인수 조건

- 원본 오디오는 API 요청에 포함하지 않는다.
- 음성 인식 실패 시 Proposal API를 호출하지 않고 텍스트 입력을 제공한다.
- 모호한 시간·잘못된 날짜·허용되지 않은 필드는 422로 거절한다.
- 변경값이 현재 StoreProfile과 같으면 `409 INVALID_STATE`로 거절한다.
- 여러 대표 메뉴를 한 변경값으로 인식한 경우 단일 값으로 확정하지 않는다.
- DRAFT만 수정·거절·승인할 수 있다.
- PATCH는 변경 목록 전체를 교체하고 같은 `field` 중복을 거절한다.
- 서버 저장값과 `currentValue`가 다르면 `409 STALE_PROPOSAL`이다.
- 거절은 승인 취소와 다르다. DRAFT를 `REJECTED`로 끝내며 외부 반영을 시작하지 않는다.

## 4. UC2: 리뷰 기반 홍보 콘텐츠 생성

### 목적

| 목적 | 의미 | 현재 UI |
|---|---|---|
| `INTRODUCTION` | 상시 매장 소개글 | 매장 특징·대표 메뉴·추천 대상을 묻는 인터뷰 |
| `NEWS` | 신메뉴·할인·이벤트·휴무 등 소식 | 소식 주제·상세 내용·기간을 묻는 인터뷰와 달력 확인 |

### 기본 흐름

1. 홈 화면이 리뷰 요약 API에서 전체 리뷰 수·요약·키워드·대표 리뷰를 읽는다.
2. 사용자가 소개글 또는 새소식 목적을 선택한다.
3. 사용자가 빠른 시작 버튼, 음성 또는 텍스트로 인터뷰에 답한다.
4. 답변은 `briefText`로 합쳐지고 리뷰 키워드는 `seedKeywords`로 전달된다.
5. 선택한 대표 리뷰 ID는 `sourceReviewIds`로 전달된다.
6. Gemini 또는 결정적 Stub이 플랫폼별 결과를 생성한다.
7. 사용자는 세 결과를 검토하고 내용 수정, 전체 거절, 전체 승인을 선택한다.
8. 내용 수정은 인터뷰 단계로 돌아가 같은 Generation을 재생성하고 `revision`을 증가시킨다.
9. 전체 승인 시 플랫폼 Task 세 개를 생성한다.

### 인수 조건

- 생성 결과는 Google·Naver·Kakao 각각 정확히 하나다.
- 각 결과는 `draftText`, `keywords`, `contentRules`를 가진다.
- `sourceReviewIds`는 선택이며 최대 10개다.
- 참고 리뷰는 대상 StoreProfile 소유이며 마스킹 완료 데이터만 사용한다.
- `DRAFT`에서만 재생성·거절·승인할 수 있다.
- 승인 요청 Body는 없고 `draftIds`를 사용하지 않는다.
- `LocalSEOContent`에 개별 승인 상태를 저장하지 않는다.
- `NEWS` 결과는 일반 소개글이 아니라 사용자가 제공한 소식과 기간을 중심으로 작성한다.
- 기간을 인식한 경우 달력에 미리 표시하고 사용자가 확인·수정할 수 있다.
- Google은 확인 가능한 사실 중심, Naver는 검색어의 자연스러운 포함, Kakao는 짧고 읽기 쉬운 안내를 생성 규칙으로 사용한다.
- 모든 플랫폼 결과는 입력에 없는 사실·과장·고객 PII를 포함하지 않아야 한다.

### 현재 구현과 원래 명세의 차이

기존 명세는 `briefText`와 `seedKeywords`를 별도 입력 컴포넌트에서 직접 편집하도록 정의했다. 현재 제품은 사용자의 부담을 줄이기 위해 인터뷰 답변과 리뷰 요약에서 이 값을 구성한다. 이 문서는 현재 UI를 정식 기준으로 채택한다.

## 5. 지원 기능: 리뷰 요약

### API 결과

- `storeProfileId`
- `reviewCount`
- `summary`
- `keywords`
- `sourceReviews` 최대 10건

### 인수 조건

- 홈 리뷰 인사이트와 UC2가 같은 응답을 사용한다.
- 전체 리뷰 수와 실제 전달하는 대표 리뷰 수를 구분한다.
- 데모 DB에서는 전체 128건, 대표 리뷰 최대 10건을 반환한다.
- 리뷰가 없을 때는 인터뷰 답변만으로 생성할 수 있음을 안내한다.

## 6. 공통 승인·상태·재시도

- 승인 API는 `Idempotency-Key`가 필수다.
- 같은 actor·같은 key·같은 승인 대상은 기존 SyncJob을 반환한다.
- 같은 actor·같은 key·다른 대상은 `409 IDEMPOTENCY_CONFLICT`다.
- 모든 성공 플랫폼은 보존하며 실패한 retryable 플랫폼만 재시도한다.
- retryable 오류는 `API_TIMEOUT`, `RATE_LIMITED`, `PLATFORM_SERVER_ERROR`다.
- `AUTHENTICATION_ERROR`, `PERMISSION_DENIED`, `PLATFORM_VALIDATION_ERROR`는 재시도하지 않는다.
- 플랫폼별 최대 시도 횟수는 3회다.

## 7. 비기능 요구사항

### 보안

- 고객 PII를 마스킹한 후에만 DB·로그·Gemini 경계로 전달한다.
- Secret은 환경변수 또는 보안 저장소에서 관리한다.
- 오류 응답은 내부 traceback과 외부 API 원문을 노출하지 않는다.

### 사용성

- 모바일 375px 이상에서 주요 CTA와 입력이 잘리지 않아야 한다.
- 음성 입력이 실패해도 텍스트 입력으로 같은 작업을 계속할 수 있어야 한다.
- 외부 Enum인 `DRAFT`는 사용자 화면에서 `검토 중`처럼 이해 가능한 문구로 표시한다.
- 한글 문장의 마지막 한두 글자가 고립되지 않도록 반응형 줄바꿈을 확인한다.

### 성능과 복구

- Gemini 호출 timeout 기본값은 20초다.
- 상태 Polling은 2초 간격, 최대 60초다.
- 프로세스 재시작 시 미완료 Task를 실패 상태로 복구한다.

## 8. 기능 요구사항 추적

| ID | 요구사항 | 현재 상태 |
|---|---|---|
| FR-001 | UC1과 UC2를 독립 시연 | Implemented |
| FR-002 | Web Speech, 원본 오디오 미전송 | Implemented |
| FR-003 | UC1 구조화·검토·수정·거절·승인 | Implemented |
| FR-004 | UC2 Generation 전체 재생성·거절·승인 | Implemented |
| FR-005 | 소개글·새소식 목적별 생성 | Implemented after v0.2 |
| FR-006 | 리뷰 요약을 홈과 UC2에서 공유 | Implemented after v0.2 |
| FR-007 | 승인 멱등성·원자 트랜잭션 | Implemented |
| FR-008 | 플랫폼별 상태·오류·재시도 | Implemented |
| FR-009 | 2초·60초 Polling UX | Implemented |
| FR-010 | 고객 PII 마스킹·안전 로그 | Implemented for defined MVP patterns |
| FR-011 | 실제 Google·Naver·Kakao 발행 | **Simulated / live integration not verified** |
| FR-012 | 실제 Gemini 생성 | Implemented, `gemini-3.6-flash` deployment verified 2026-08-17 |
