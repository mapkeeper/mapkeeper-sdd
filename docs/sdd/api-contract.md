# MapKeeper API Contract

> 상태: **Canonical human-readable contract**
> 기계 판독 기준: `workspace/backend/openapi.json`
> 기준 코드: `2026-08-17 current working tree` (base `12687c2ed099cc6369d45b59791fa3ca62ea106d`)
> 최종 대조일: `2026-08-17`
> 담당: 백엔드, 프론트엔드 교차 검토

## 1. 공통 규칙

- Base URL: `/api/v1`
- JSON 필드: camelCase
- ID: UUID 문자열
- 시각: UTC ISO 8601
- 요청 schema에 정의되지 않은 필드: 거절
- 승인 API: `Idempotency-Key` 필수
- 요청 추적: `X-Request-ID`, 미입력 시 서버 생성
- `approvedBy`: 요청에서 받지 않는다. 로컬 Mock에서는 `MVP_ACTOR_ID`, 공개 배포에서는 검증된 Firebase UID에서 서버가 생성한다.

### 성공 Envelope

```json
{
  "success": true,
  "status": "SUCCESS",
  "data": {},
  "error": null,
  "timestamp": "2026-08-17T00:00:00Z"
}
```

### 실패 Envelope

```json
{
  "success": false,
  "status": "FAILED",
  "data": null,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "요청 값이 올바르지 않습니다.",
    "details": [{"field": "body.seedKeywords.0", "reason": "string required"}],
    "retryable": null,
    "failure": null
  },
  "timestamp": "2026-08-17T00:00:00Z"
}
```

`details`는 입력 검증 오류의 필드별 설명이고, 최상위 `retryable`은 현재 공통 오류 모델의 선택 필드다. 플랫폼 반영 재시도 여부는 `platformTasks[].error.retryable`을 기준으로 판단한다.

### 실패 원인 모델

`error.failure`는 서버가 무엇을 고쳐야 하는지 말할 수 있을 때만 채운다. `code`는 어떤 계약 규칙을 어겼는지, `message`는 그것을 한 문장으로 말하지만, 둘 다 화면이 무엇을 제안해야 하는지는 알려주지 않는다. 사용자가 행동할 수 없는 거절은 과업을 끝내므로, 원인을 기계 판독 가능한 값으로 주고 다시 말하는 방법과 원본 입력을 함께 돌려준다.

```json
{
  "reason": "AMBIGUOUS_TIME",
  "message": "몇 시인지 정확히 알 수 없어요.",
  "guidance": "“오후”, “저녁”처럼 대략적인 때만 말씀하셨거나 시계에 없는 시각이라 시각을 정하지 못했어요.",
  "retry": "몇 시인지 함께 말씀해 주세요. 하루 종일 쉬시는 거라면 시각 대신 날짜로 말씀해 주세요.",
  "examples": ["영업시간을 밤 10시까지로 바꿔줘", "내일 하루 쉽니다"],
  "recognizedTextMasked": "오후에 문을 닫습니다"
}
```

| 필드 | 의미 |
|---|---|
| `reason` | `ProposalFailureReason` 값. 화면 분기의 기준이다. |
| `message` | 무엇이 문제인지 한 문장 |
| `guidance` | 왜 그렇게 판단했는지 |
| `retry` | 다시 말하는 구체적 방법 |
| `examples` | 그대로 다시 시도할 수 있는 문장 |
| `recognizedTextMasked` | 마스킹된 원본 입력. 화면은 이 값을 입력창에 되돌린다. |

현재 이 객체를 채우는 것은 UC1 변경안 생성뿐이다. 다른 Endpoint는 `null`을 반환하며, 클라이언트는 없는 경우를 항상 처리해야 한다. `recognizedTextMasked`는 고객 PII를 제거한 뒤의 문장이므로 Constitution 6.2를 위반하지 않는다.

이하 각 Endpoint의 성공 응답 예시는 가독성을 위해 공통 Envelope의 `data` 객체만 표시한다. 실제 HTTP 응답은 항상 위 성공 Envelope로 감싼다. 승인 Endpoint의 최상위 `status`는 `PROCESSING`, 나머지 동기 성공 응답은 `SUCCESS`다.

## 2. Enum

| Enum | 값 |
|---|---|
| `ApiResponseStatus` | `SUCCESS`, `PROCESSING`, `FAILED` |
| `Platform` | `google`, `naver`, `kakao` |
| `ProposalStatus` | `DRAFT`, `APPROVED`, `REJECTED` |
| `ContentGenerationStatus` | `DRAFT`, `APPROVED`, `REJECTED` |
| `ContentPurpose` | `INTRODUCTION`, `NEWS` |
| `SyncJobStatus` | `PENDING`, `PROCESSING`, `PARTIAL_SUCCESS`, `SUCCESS`, `FAILED`, `RETRYING` |
| `PlatformSyncTaskStatus` | `PENDING`, `PROCESSING`, `SUCCESS`, `FAILED`, `RETRYING` |
| `SyncSourceType` | `STORE_CHANGE_PROPOSAL`, `CONTENT_GENERATION` |
| `ContentApprovalStatus` (PM Beta) | `DRAFT`, `APPROVED`, `REJECTED` |
| `ProposalFailureReason` | `AMBIGUOUS_TIME`, `AMBIGUOUS_DATE`, `UNREADABLE_DATE_RANGE`, `INVALID_DATE`, `MULTIPLE_MENU_CANDIDATES`, `UNSUPPORTED_FIELD`, `NO_CHANGE_FOUND`, `NO_EFFECTIVE_CHANGE` |

`PARTIAL_SUCCESS`는 SyncJob에만 허용한다.

### API 오류 코드

`MALFORMED_REQUEST`, `VALIDATION_ERROR`, `RESOURCE_NOT_FOUND`, `INVALID_STATE`, `STALE_PROPOSAL`, `IDEMPOTENCY_CONFLICT`, `NO_RETRYABLE_TASKS`, `REQUEST_RATE_LIMITED`, `AUTHENTICATION_REQUIRED`, `INTERNAL_SERVER_ERROR`

### 플랫폼 Task 오류 코드

| 코드 | 재시도 |
|---|---|
| `API_TIMEOUT` | 가능 |
| `RATE_LIMITED` | 가능 |
| `PLATFORM_SERVER_ERROR` | 가능 |
| `AUTHENTICATION_ERROR` | 불가 |
| `PERMISSION_DENIED` | 불가 |
| `PLATFORM_VALIDATION_ERROR` | 불가 |

## 3. 입력 제한

| 필드 | 제한 |
|---|---|
| `recognizedText` | 1~500자 |
| `representativeMenuName` | 1~50자 |
| `parkingInfo` | 1~50자 |
| `briefText` | 1~500자 |
| `seedKeywords` | 0~5개, 각 1~30자 |
| `draftText` | 1~750자 |
| `drafts[].keywords` | 1~10개, 각 1~30자 |
| `sourceReviewIds` | 선택, 최대 10개, 중복 불가 |
| `toneInstruction` | 선택, 1~100자 |
| `Idempotency-Key` | 1~128자, `[A-Za-z0-9._:-]` |
| `attemptCount` | 0~3 |

키워드는 앞의 `#`과 주변 공백을 제거하고 입력 순서대로 중복을 정리한다.
리뷰가 없는 매장은 리뷰 키워드도 없으므로 `seedKeywords`는 빈 배열을 허용한다. 비어 있으면 프롬프트에서 키워드 항목 자체를 제외한다 — 최소 1개를 강제하면 없는 키워드를 지어내게 된다.
`seedKeywords`에 문자열이 아닌 값이 하나라도 포함되면 해당 값을 삭제해 계속하지 않고 요청 전체를 `422 VALIDATION_ERROR`로 거절한다.

프론트 제품 서비스는 동일 계약을 Zod strict schema로 파싱한다. 잘못된 Enum, 필수 필드 누락, 정의되지 않은 응답 필드는 UI 상태로 변환하기 전에 거절한다.

플랫폼별 콘텐츠 생성 규칙:

| 플랫폼 | 규칙 |
|---|---|
| Google | 확인 가능한 매장 정보를 사실 중심으로 간결하게 작성한다. |
| Naver | 지역명·메뉴명 같은 검색어를 문장에 자연스럽게 포함한다. |
| Kakao | 짧고 읽기 쉬운 매장 안내 중심으로 작성한다. |

공통으로 입력에 없는 사실·과장·고객 PII를 만들지 않는다. `contentRules`는 서버가 생성한 읽기 전용 정보이며 클라이언트 요청으로 입력하거나 수정하지 않는다.

리뷰 요약의 `reviewCount`가 0이면 `keywords`는 빈 배열이어야 한다. 서버와 클라이언트는 기본 긍정 키워드를 삽입하지 않으며, 생성 결과도 리뷰 근거 없는 장점을 포함할 수 없다.

이 규칙은 프롬프트 지시가 아니라 생성 응답 경계에서 강제한다. 모델 응답의 구조 검증(플랫폼 3종·길이·키워드 수)을 통과해도 다음을 추가로 적용한다.

- `draftText`와 `keywords`의 고객 PII는 저장 전에 결정적으로 마스킹한다. 해당 매장의 공개 주소·대표번호는 Constitution 6.3의 승인된 비즈니스 정보이므로 유지한다.
- 입력이 뒷받침하지 않는 주장을 담은 결과는 저장하지 않고 `500 INTERNAL_SERVER_ERROR`, `retryable: true`로 거절한다. 근거가 되는 입력은 `briefText`, `seedKeywords`, 참고 리뷰, StoreProfile이며 `toneInstruction`은 근거가 아니다.
- 주장으로 판단하는 대상은 단위가 붙은 수치(`%`·`퍼센트`·`원`·`만원`·`천원`·`배`·`위`·`등`)와 최상급 표현(`최고`·`최상`·`최초`·`최대`·`최저`·`유일`·`무조건`·`보장`·`완벽`)이다. 단위가 없는 수(날짜·인원 등)는 주장으로 보지 않는다.
- 마스킹 결과가 `draftText`·`keywords` 제한을 넘기면 잘라내지 않고 같은 방식으로 거절한다.

`toneInstruction`은 문체를 바꿔 다시 써 달라는 지시이며 문구에 담을 내용이 아니다. 저장하지 않고 해당 요청의 프롬프트에만 사용하며, 결정적 Stub은 무시한다. 사장님이 직접 입력할 수 있는 자유 텍스트이므로 `briefText`·`seedKeywords`와 동일하게 Gemini 경계 이전에 고객 PII를 마스킹한다. `briefText`에 합쳐 보내지 않는다 — 합치면 사장님이 말한 내용이 되어 결정적 Stub이 지시문을 그대로 문구에 옮기고, 승인 시 3사에 게시된다.

`briefText`와 `draftText`의 고객 PII는 마스킹하지만, 해당 매장의 공개 주소와 대표번호는 Constitution 6.3의 승인된 비즈니스 정보이므로 마스킹하지 않는다.

> 현재 격차: `seedKeywords` 배열에 비문자 값과 문자열을 섞으면 비문자 값을 조용히 제거한다. 계약상 422로 거절하도록 수정해야 한다.

## 4. UC1 Proposal API

### 4.1 변경안 생성

```http
POST /api/v1/store-change-proposals
```

```json
{
  "storeProfileId": "11111111-1111-4111-8111-111111111111",
  "recognizedText": "대표 메뉴를 김치찌개로 바꿔줘",
  "locale": "ko-KR"
}
```

응답: `201 Created`

```json
{
  "proposalId": "22222222-2222-4222-8222-222222222222",
  "recognizedTextMasked": "대표 메뉴를 김치찌개로 바꿔줘",
  "changes": [
    {
      "field": "representativeMenuName",
      "currentValue": "만두전골",
      "proposedValue": "김치찌개"
    }
  ],
  "status": "DRAFT",
  "unmappedRequests": []
}
```

허용 `changes` 변형:

```json
{"field":"businessHours","currentValue":{"open":"09:00","close":"22:00"},"proposedValue":{"open":"10:00","close":"23:00"}}
```

```json
{"field":"temporaryClosure","currentValue":null,"proposedValue":{"startDate":"2026-08-18","endDate":"2026-08-18"}}
```

```json
{"field":"representativeMenuName","currentValue":"만두전골","proposedValue":"김치찌개"}
```

```json
{"field":"parkingInfo","currentValue":null,"proposedValue":"건물 뒤 3대 가능"}
```

#### 상대 날짜·기간·복합 요청

- 상대 날짜(`오늘`, `내일`, `모레`, `이번 주 <요일>`, `다음 주 <요일>`, `이번 주`, `다음 주`)는 Asia/Seoul 기준일로 계산해 확정 날짜로 구조화한다. 계산할 수 없는 표현(`조만간`, `곧`)은 확정하지 않고 `AMBIGUOUS_DATE`로 재확인한다.
- 명절 연휴(`추석 연휴`, `추석 연휴 전체`, `설 연휴`)는 공식 공휴일 표의 해당 연휴 전체 기간으로, `추석 당일`·`설날 당일`은 명절 당일 하루로 구조화한다. 기준일(Asia/Seoul) 이후 아직 끝나지 않은 연휴를 사용하며, 연휴 기간에는 대체공휴일을 포함한다.
- `이번 추석`처럼 `당일`·`연휴` 중 무엇인지 말하지 않은 문장은 어느 쪽으로도 확정하지 않고 `AMBIGUOUS_DATE`로 재확인한다. 이때 `guidance`·`retry`·`examples`는 해당 연휴의 실제 날짜와 다시 말할 수 있는 두 문장(`추석 연휴 전체 쉽니다`, `추석 당일 하루 쉽니다`)을 담는다. 새 Enum 값이나 새 필드는 추가하지 않으므로 기존 클라이언트는 그대로 동작한다.
- 공휴일 날짜는 요청 시점에 외부를 호출하지 않고 서비스에 동봉한 공식 공휴일 표에서 읽는다. 표가 다루지 않는 연도나 표를 읽지 못한 경우에는 날짜를 추정하지 않고 기존 `AMBIGUOUS_DATE` 재확인으로 처리한다. 표의 범위와 출처는 `workspace/backend/src/mapkeeper/adapters/korean_holidays.json`에 함께 기록한다. FR-016(`CalendarEvent` 수집·저장)은 여전히 `Planned`이며, 이 표는 그 자리에 들어갈 조회 지점을 같은 모양으로 먼저 채운 것이다.
- 기간은 시작일과 종료일을 모두 구조화한다. `…부터 …까지`의 두 번째 끝이 월(`8월 25일부터 26일까지`)이나 주(`다음 주 월요일부터 수요일까지`)를 생략해도 첫 번째 끝의 문맥으로 해석한다. 한쪽 끝을 읽지 못하면 읽은 쪽만 반영하지 않고 `UNREADABLE_DATE_RANGE`로 거절한다.
- 기간 표현(`하루`, `이틀`, `3일간`)은 시작일에서 해당 일수만큼의 종료일을 계산한다.
- 한 문장이 여러 항목을 말하면 항목별 변경안으로 분리한다. `9월 1일은 임시 휴무이고 주차는 불가능합니다`는 `temporaryClosure`와 `parkingInfo` 두 개의 변경안이 된다.
- 주차 가능·불가 진술(`주차는 불가능합니다`)은 `주차 불가`, `주차 가능`으로 구조화한다. 그 이상을 말하는 문장은 저장할 값을 직접 명시해야 한다.
- 구조화하지 못한 항목은 조용히 버리지 않고 `unmappedRequests`에 한국어 항목명으로 담는다. 승인 화면은 이 목록을 표시해야 한다.
- 어떤 항목도 구조화하지 못하면 `422 VALIDATION_ERROR`와 함께 위 `error.failure`를 반환한다.

### 4.2 변경안 전체 교체

```http
PATCH /api/v1/store-change-proposals/{proposalId}
```

Body는 `{"changes": [...]}`다. DRAFT만 수정할 수 있고 같은 field 중복을 거절한다. `currentValue`가 저장된 Proposal과 다르면 `409 STALE_PROPOSAL`이다.

### 4.3 변경안 거절

```http
POST /api/v1/store-change-proposals/{proposalId}/reject
```

Body 없음. DRAFT를 `REJECTED`로 변경하고 Proposal 응답을 반환한다.

### 4.4 변경안 승인

```http
POST /api/v1/store-change-proposals/{proposalId}/approve
Idempotency-Key: required
```

응답: `202 Accepted`

```json
{
  "proposalId": "22222222-2222-4222-8222-222222222222",
  "proposalStatus": "APPROVED",
  "syncJobId": "66666666-6666-4666-8666-666666666666",
  "status": "PENDING",
  "statusUrl": "/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666"
}
```

## 5. 리뷰 요약 API

```http
GET /api/v1/store-profiles/{storeProfileId}/reviews/summary
```

응답: `200 OK`

```json
{
  "storeProfileId": "11111111-1111-4111-8111-111111111111",
  "reviewCount": 128,
  "summary": "속이 꽉 찬 만두와 깊고 깔끔한 국물 맛에 대한 칭찬이 가장 많아요.",
  "keywords": ["속이알참", "친절함", "주차편함"],
  "sourceReviews": [
    {
      "id": "55555555-5555-4555-8555-555555555555",
      "storeProfileId": "11111111-1111-4111-8111-111111111111",
      "bodyMasked": "[고객명]님 가족과 방문했는데 국물이 깊었어요.",
      "createdAt": "2026-08-17T00:00:00Z"
    }
  ]
}
```

`reviewCount`는 전체 수이고 `sourceReviews`는 최대 10건이다. 현재 요약 문장과 키워드는 결정적 데모 규칙을 사용한다.

## 6. UC2 Generation API

### 6.1 생성

```http
POST /api/v1/seo/generations
```

```json
{
  "storeProfileId": "11111111-1111-4111-8111-111111111111",
  "purpose": "NEWS",
  "briefText": "여름 방학 동안 신메뉴 김치만두를 할인 판매합니다. 기간은 8월 20일부터 31일까지입니다.",
  "seedKeywords": ["김치만두", "신메뉴", "할인"],
  "sourceReviewIds": ["55555555-5555-4555-8555-555555555555"]
}
```

`purpose`를 생략하면 `INTRODUCTION`이다. `toneInstruction`도 선택이다. 응답은 `201 Created`이며 `generationId`, `status=DRAFT`, `revision`, 플랫폼별 `drafts` 세 개를 반환한다.

```json
{
  "generationId": "33333333-3333-4333-8333-333333333333",
  "status": "DRAFT",
  "revision": 1,
  "drafts": [
    {
      "draftId": "44444444-4444-4444-8444-444444444441",
      "platform": "google",
      "draftText": "Google용 문구",
      "keywords": ["김치만두", "신메뉴"],
      "contentRules": ["사실 중심"]
    }
  ]
}
```

실제 응답에는 Google·Naver·Kakao가 각각 하나씩 포함된다.

### 6.2 전체 재생성

```http
POST /api/v1/seo/generations/{generationId}/regenerate
```

Body는 생성 요청에서 `storeProfileId`를 제외한 형태다. DRAFT만 가능하며 기존 세 결과를 새 결과로 교체하고 `revision`을 1 증가시킨다. 화면의 문체 변경(정중하게·친근하게·짧게)은 `briefText`를 그대로 두고 `toneInstruction`으로 전달한다.

### 6.3 사장님 편집 반영

```http
PATCH /api/v1/seo/generations/{generationId}/drafts
```

```json
{
  "drafts": [
    { "platform": "google", "draftText": "사장님이 고친 Google용 문구", "keywords": ["김치만두"] },
    { "platform": "naver", "draftText": "사장님이 고친 Naver용 문구", "keywords": ["김치만두"] },
    { "platform": "kakao", "draftText": "사장님이 고친 Kakao용 문구", "keywords": ["김치만두"] }
  ]
}
```

승인은 저장된 내용을 게시하므로, 확인 화면에서 고친 문구는 승인 전에 이 Endpoint로 저장한다. DRAFT만 가능하며 세 플랫폼을 모두 포함해야 하고 `revision`을 1 증가시킨다. `draftText`·`keywords` 제한은 생성 결과와 동일하다.

### 6.4 전체 거절

```http
POST /api/v1/seo/generations/{generationId}/reject
```

Body 없음. DRAFT를 `REJECTED`로 변경한다.

### 6.5 전체 승인

```http
POST /api/v1/seo/generations/{generationId}/approve
Idempotency-Key: required
```

Body와 `draftIds`가 없다. 응답은 `202 Accepted`다.

### 6.6 플랫폼별 승인 (PM Beta, Planned)

```http
POST /api/v1/seo/generations/{generationId}/drafts/{platform}/approve
Idempotency-Key: required
```

선택한 플랫폼의 `LocalSEOContent.approvalStatus`만 `APPROVED`로 변경하고 해당 플랫폼 Task만 생성한다. 전체 승인 Endpoint는 모든 플랫폼에 대한 편의 동작으로 유지하되, 개별 승인된 플랫폼을 다시 승인하지 않는다.

### 6.7 플랫폼별 편집·부분 재생성 (PM Beta, Planned)

```http
PATCH /api/v1/seo/generations/{generationId}/drafts/{platform}
POST /api/v1/seo/generations/{generationId}/drafts/{platform}/regenerate
```

직접 편집·재생성은 해당 플랫폼 결과만 갱신하고 Generation revision을 증가시킨다. 전체 결과와 플랫폼별 결과가 섞이지 않도록 응답에 `platform`, `revision`, `contentRules`를 포함한다.

### 6.8 일정 조회 (PM Beta P1, Planned)

```http
GET /api/v1/calendar-events?from=YYYY-MM-DD&to=YYYY-MM-DD&category=HOLIDAY|UNIVERSITY
```

응답에는 일정 날짜, 공개 출처 URL, `retrievedAt`, `lastVerifiedAt`, 상태를 포함한다. 조회 실패는 일반 문구 생성 실패와 분리한다.

### 6.9 게시 준비도 (PM Beta P1, Planned)

```http
GET /api/v1/seo/generations/{generationId}/readiness
```

검색 순위가 아닌 사실 일치성·플랫폼 적합성·정보 완성도·일정 최신성·과장·키워드 과다·이미지 보완 필요를 검사한다.

```json
{
  "generationId": "33333333-3333-4333-8333-333333333333",
  "generationStatus": "APPROVED",
  "approvedPlatforms": ["google", "naver", "kakao"],
  "syncJobId": "66666666-6666-4666-8666-666666666666",
  "status": "PENDING",
  "statusUrl": "/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666"
}
```

## 7. SyncJob API

### 7.1 상태 조회

```http
GET /api/v1/sync-jobs/{syncJobId}
```

```json
{
  "syncJobId": "66666666-6666-4666-8666-666666666666",
  "status": "PARTIAL_SUCCESS",
  "platformTasks": [
    {
      "platform": "naver",
      "status": "FAILED",
      "attemptCount": 2,
      "error": {
        "code": "API_TIMEOUT",
        "message": "Naver 플랫폼 처리 시간이 초과되었습니다.",
        "retryable": true,
        "platform": "naver"
      }
    }
  ]
}
```

현재 구현 응답에는 플랫폼 Task 세 개가 정확히 하나씩 포함된다. PM Beta의 플랫폼별 승인 전환 후에는 승인된 플랫폼 Task만 생성하며, API 응답 계약을 갱신한다.

### 7.2 실패 플랫폼 재시도

```http
POST /api/v1/sync-jobs/{syncJobId}/retry
```

Body 없음. 재시도 가능한 실패 Task만 `RETRYING`으로 변경하고 `202 Accepted`를 반환한다. 대상이 없으면 `409 NO_RETRYABLE_TASKS`다.

## 8. Endpoint 요약

| # | 메서드 | 경로 | HTTP |
|---:|---|---|---:|
| 1 | POST | `/api/v1/store-change-proposals` | 201 |
| 2 | PATCH | `/api/v1/store-change-proposals/{proposalId}` | 200 |
| 3 | POST | `/api/v1/store-change-proposals/{proposalId}/reject` | 200 |
| 4 | POST | `/api/v1/store-change-proposals/{proposalId}/approve` | 202 |
| 5 | GET | `/api/v1/store-profiles/{storeProfileId}/reviews/summary` | 200 |
| 6 | POST | `/api/v1/seo/generations` | 201 |
| 7 | POST | `/api/v1/seo/generations/{generationId}/regenerate` | 200 |
| 8 | PATCH | `/api/v1/seo/generations/{generationId}/drafts` | 200 |
| 9 | POST | `/api/v1/seo/generations/{generationId}/reject` | 200 |
| 10 | POST | `/api/v1/seo/generations/{generationId}/approve` | 202 |
| 11 | GET | `/api/v1/sync-jobs/{syncJobId}` | 200 |
| 12 | POST | `/api/v1/sync-jobs/{syncJobId}/retry` | 202 |
| 13 | POST | `/api/v1/seo/generations/{generationId}/drafts/{platform}/approve` | Planned |
| 14 | PATCH | `/api/v1/seo/generations/{generationId}/drafts/{platform}` | Planned |
| 15 | POST | `/api/v1/seo/generations/{generationId}/drafts/{platform}/regenerate` | Planned |
| 16 | GET | `/api/v1/calendar-events` | Planned |
| 17 | GET | `/api/v1/seo/generations/{generationId}/readiness` | Planned |

`GET /health`는 운영 health 경로이며 `/api/v1` 제품 Endpoint 수에서 제외한다.

## 9. Polling 계약

- 기본 간격: 2초
- 자동 조회 최대 시간: 60초
- 종료 상태: `SUCCESS`, `PARTIAL_SUCCESS`, `FAILED`
- 화면 이탈: 진행 중 요청을 abort
- 60초 경과: 서버 작업은 유지, 자동 Polling만 중단, 다시 확인 제공
- 네트워크 오류: 무한 재시도 금지

> 현재 프론트 구현은 이 계약을 충족하지 않는다.
