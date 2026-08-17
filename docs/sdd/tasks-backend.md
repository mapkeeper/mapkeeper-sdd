# MapKeeper Backend TASK

> 담당: 백엔드
> 상태: **Canonical / current implementation mapped**
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

### PII 검증 범위

- 고객 이름·전화번호·상세 도로명 주소를 Gemini 호출 전에 마스킹한다.
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

현재 테스트 inventory는 561개이며 로컬 PostgreSQL 16에서 561개 전체 통과, skip 0, 커버리지 93.55%를 확인했다. 현재 변경을 커밋한 뒤 원격 CI 증거를 추가한다.

## 7. 남은 우선순위

| 우선순위 | 작업 | 완료 조건 |
|---:|---|---|
| P0 | 최신 변경 CI·개발 배포 | 561개·93.55% 원격 재확인 |
| P1 | 실제 모바일 음성 QA 지원 | 수동 테스트의 backend 요청·로그 확인 |
| P2 | 실제 3사 Adapter | 별도 sandbox/운영 계약 검증 |
