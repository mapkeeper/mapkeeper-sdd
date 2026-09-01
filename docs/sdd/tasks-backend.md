# MapKeeper Backend TASK

> 담당: 백엔드
> 상태: **Canonical / PM Beta scope mapped**
> 기준 코드: `2026-08-17 current working tree` (base `12687c2ed099cc6369d45b59791fa3ca62ea106d`)

## 1. 완료된 기반 작업

| ID | 작업 | 상태 |
|---|---|---|
| T204 | Envelope·Enum·오류 모델 | Done |
| T206 | UC1 ProposalChange schema | Done |
| T208 | UC2 Generation schema | Done, purpose 추가 반영 |
| T210 | OpenAPI 생성·drift guard | Done, 제품 API 11개 |
| T212 | SQLAlchemy async·PostgreSQL | Done |
| T213~T215 | 핵심 ORM 모델 | Done |
| T216 | Alembic migration | Done, head `0003` |
| T217 | StoreProfile·SourceReview seed | Done, 리뷰 128건 |

## 2. 승인·상태·재시도

| ID | 작업 | 상태 | 비고 |
|---|---|---|---|
| T218 | Request ID·안전 오류 Envelope | Done | 예상 밖 예외도 타입만 기록, 메시지·PII 비노출 테스트 |
| T219 | 멱등성 replay·conflict | Done | actor + key Unique |
| T220 | UC1 승인 트랜잭션 | Done | StoreProfile 포함 원자 처리 |
| T221 | UC2 전체 승인 트랜잭션 | Done | draftIds 없음 |
| T222 | Adapter Protocol·오류 정규화 | Done | 6개 플랫폼 오류 |
| T223 | Job 상태 집계 | Done | PARTIAL_SUCCESS Job 전용 |
| T224 | 최대 3회 지수 백오프 | Done | `nextRetryAt` 이전 실행 차단·예약 시각까지 대기 |
| T225 | 상태 조회·retry API | Done | retryable 실패만 |
| T226 | 재시작 복구 | Done | 미완료 Task FAILED 전환 |

## 3. UC1

| ID | 작업 | 상태 |
|---|---|---|
| T227 | create·patch·reject | Done |
| T228 | PII 마스킹·Gemini 구조화 | Done |
| T229 | approve·statusUrl·BackgroundTasks | Done |
| 추가 | 동일 값 변경 거절 | Done |
| 추가 | 여러 대표 메뉴 거절 | Done |
| 추가 | 상대 날짜·다양한 발화 parser | Done |
| T256 | 기간 양끝 구조화·복합 절 분리·실패 원인 모델 | Done |

### T256 상대 날짜·기간·복합 의도·실패 원인

`adapters/intent.py`가 문장을 연결 어미(`이고`·`하고`·`되고`·`고`·`이며`·`하며`·`그리고`·쉼표)로 절 단위로 나눈 뒤 각 절을 따로 읽고, 항목별로 하나씩 변경안을 만든다. 두 절이 같은 필드를 답하면 분리가 한 진술을 가른 것이므로(`10시에 열고 21시에 닫아요`) 분리를 버리고 문장 전체 판독으로 되돌린다.

`…부터 …까지`는 두 끝을 따로 읽는다. 두 번째 끝이 월(`26일`)이나 주(`수요일`)를 생략하면 첫 번째 끝의 문맥으로 해석한다. 한쪽 끝을 읽지 못하면 읽은 쪽만 제안하지 않고 전체를 거절한다 — 사장님이 사흘을 쉰다고 말했는데 하루만 반영되면 나머지 이틀 동안 매장이 열려 있는 것으로 3사에 올라간다.

`주차는 불가능합니다`처럼 저장할 값을 명시하지 않은 주차 진술은 `주차 불가`·`주차 가능`으로 구조화한다. `불가능`이 `가능`을 포함하므로 불가 판정을 먼저 한다.

`services/proposal_failure.py`가 읽지 못한 문장을 `ProposalFailureReason`으로 분류하고, 원인·안내·재시도 방법·예시 문장·마스킹된 원본 입력을 `error.failure`로 반환한다. Parser·결정적 Stub·Gemini가 모두 `UnsupportedChangeError`로 거절하므로 분류는 `services/proposal.py`의 한 지점에서 수행한다.

### PII 검증 범위

- 고객 이름·전화번호·상세 도로명 주소를 Gemini 호출 전에 마스킹한다.
- `고객 홍길동님`처럼 접두어와 `님`이 함께 붙은 호칭형 고객 이름도 마스킹한다.
- 해당 매장의 공개 주소·대표번호는 고객 PII가 아니므로 마스킹하지 않는다.
- 공개 영업시간은 PII로 마스킹하지 않는다.
- 예상 밖 예외 로그에는 예외 타입만 남기고 메시지·민감 입력은 남기지 않는다.
- 실제 운영에서 새 PII 표현을 발견하면 패턴과 회귀 테스트를 함께 추가한다.

## 4. UC2와 리뷰

| ID | 작업 | 상태 |
|---|---|---|
| T232 | Gemini/Stub 3사 생성 | Done |
| T233 | regenerate·reject | Done |
| T234 | Generation 전체 approve | Done |
| T246 | ContentPurpose INTRODUCTION·NEWS | Done |
| T247 | 리뷰 요약 API | Done |
| T248 | 리뷰 128건 seed | Done |
| 추가 | 목적별 Gemini prompt | Done |
| 추가 | 마스킹 리뷰 최대 10건 전달 | Done |

### 입력 검증

`seedKeywords` 배열에 숫자·null·객체 등 비문자 원소가 하나라도 있으면 조용히 제거하지 않고 요청 전체를 422로 거절한다.

`toneInstruction`은 선택 1~100자이며 저장하지 않는다. Gemini 프롬프트에서는 사장님 입력과 분리된 `말투 요청` 블록으로 전달하고, 결정적 Stub은 무시한다. `briefText`에 합치면 Stub이 지시문을 문구로 출력한다. 전달 전에 `briefText`와 같은 마스커를 통과시킨다 — 자유 텍스트이므로 고객 이름·전화번호가 들어올 수 있고, 문구로 쓰이지 않더라도 Gemini 요청에 남으면 Constitution 6.2 위반이다.

생성기가 무엇을 반환하든 `services/content_safety.py`의 `enforce_publication_safety`를 통과한 뒤에만 저장한다. Gemini·Stub·향후 교체 어댑터가 모두 같은 서비스 경로로 저장되므로 어댑터가 아니라 서비스에서 강제한다. 고객 PII는 마스킹하고, 입력이 뒷받침하지 않는 수치·최상급 주장은 `UnsafeGeneratedContentError`(retryable)로 거절한다.

`briefText`·`draftText`·`seedKeywords`·참고 리뷰를 마스킹할 때 해당 매장의 공개 주소와 대표번호는 승인된 비즈니스 정보로 보존한다.

## 5. 외부 Adapter 상태

| Adapter | 현재 구현 | 상태 |
|---|---|---|
| Gemini proposal | 실제 HTTP + Stub fallback | Implemented |
| Gemini SEO | 실제 HTTP + Stub fallback | Implemented |
| Google publish | AcceptingAdapter | Simulated |
| Naver publish | AcceptingAdapter | Simulated |
| Kakao publish | AcceptingAdapter | Simulated |

실제 3사 클라이언트를 추가할 때 `PlatformAdapter` Protocol과 오류 정규화 계약을 유지한다.

## 6. 검증 명령

```bash
cd workspace/backend
uv run --locked python -m mapkeeper.openapi
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked basedpyright
uv run --locked pytest --cov=mapkeeper --cov-report=term-missing --cov-fail-under=90
```

현재 테스트 inventory는 726개이며 로컬 PostgreSQL에서 726개 전체 통과, skip 0, 커버리지 93.96%를 확인했다 (2026-08-30, T256 포함). 현재 변경을 커밋한 뒤 원격 CI 증거를 추가한다.

## 7. 남은 우선순위

| 우선순위 | 작업 | 완료 조건 |
|---:|---|---|
| P0 | 최신 변경 CI·개발 배포 | 726개·93.96% 원격 재확인 |
| P1 | 실제 모바일 음성 QA 지원 | 수동 테스트의 backend 요청·로그 확인 |
| P2 | 실제 3사 Adapter | 별도 sandbox/운영 계약 검증 |

## 8. PM Beta 추가 작업

| 우선순위 | 작업 | 상태 | 완료 조건 |
|---:|---|---|---|
| P0 | UC1 상대 날짜·기간·복합 의도·실패 원인 모델 (T256) | Done | 모두 구조화하거나 누락 항목·재시도 방법을 응답 |
| P0 | UC2 근거 기반 생성 경계 강화 | Planned | 리뷰 0건 키워드 없음, 메뉴·가격·혜택·장점 허위 0건 |
| P0 | 플랫폼별 승인·편집·부분 재생성 | Planned | 플랫폼별 승인 상태와 해당 Task만 원자적으로 생성 |
| P0 | 상태·지연·복구 공통 모델 | Planned | VALIDATING/GENERATING, 10초 안내, 30초 복구 경로 |
| P0 | StoreProfile·seed 정합성 검사 | Planned | 주소·메뉴·키워드·리뷰 근거 회귀 테스트 |
| P1 | CalendarEvent 수집·검색·출처 추적 | Planned | 공식 공휴일·아주대 공개 일정, 중복·만료·취소 처리 |
| P1 | 일정별 질문 분기 | Planned | 선택 일정 날짜 확인, 조회 실패 시 일반 작성 유지 |
| P1 | 플랫폼별 생성 규칙·게시 준비도 | Planned | 사실성·형식·최신성·과장·키워드 과다 진단 |
