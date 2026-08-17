# MapKeeper Backend TASK

> 담당: 백엔드
> 상태: **Canonical / current implementation mapped**
> 기준 커밋: `206ad82198aa8c76652f3001ee6bd31d24cd360d`

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
| T218 | Request ID·안전 오류 Envelope | Done with review gap | traceback 민감값 검토 필요 |
| T219 | 멱등성 replay·conflict | Done | actor + key Unique |
| T220 | UC1 승인 트랜잭션 | Done | StoreProfile 포함 원자 처리 |
| T221 | UC2 전체 승인 트랜잭션 | Done | draftIds 없음 |
| T222 | Adapter Protocol·오류 정규화 | Done | 6개 플랫폼 오류 |
| T223 | Job 상태 집계 | Done | PARTIAL_SUCCESS Job 전용 |
| T224 | 최대 3회 지수 백오프 | **Done with gap** | 실제 대기 미구현 |
| T225 | 상태 조회·retry API | Done | retryable 실패만 |
| T226 | 재시작 복구 | Done | 미완료 Task FAILED 전환 |

## 3. UC1

| ID | 작업 | 상태 |
|---|---|---|
| T227 | create·patch·reject | Done |
| T228 | PII 마스킹·Gemini 구조화 | Done with gap |
| T229 | approve·statusUrl·BackgroundTasks | Done |
| 추가 | 동일 값 변경 거절 | Done |
| 추가 | 여러 대표 메뉴 거절 | Done |
| 추가 | 상대 날짜·다양한 발화 parser | Done |

### PII 남은 과제

- 고객 식별자 패턴 추가
- 접두어 없는 상세 주소와 이름 처리 전략 확정
- 정상 영업시간·공개 매장 정보가 과잉 마스킹되지 않는 회귀 테스트
- unexpected exception 로그에 민감 입력이 포함되지 않는 테스트

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

### 입력 검증 남은 과제

`seedKeywords` 배열의 비문자 원소를 현재 전처리에서 제거한다. 계약대로 전체 요청을 422로 거절하도록 validator를 수정하고 테스트한다.

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

현재 테스트 inventory는 555개이며 로컬 PostgreSQL 16에서 555개 전체 통과, 커버리지 93.48%를 확인했다. Pull Request CI가 성공하면 해당 SHA와 원격 실행 링크를 추가한다.

## 7. 남은 우선순위

| 우선순위 | 작업 | 완료 조건 |
|---:|---|---|
| P0 | 실제 retry backoff | `nextRetryAt` 이전 실행 0회 |
| P0 | PII 마스킹 강화 | Constitution 대상 누락 0건 |
| P1 | 비문자 keyword 422 | 잘못된 배열을 조용히 정리하지 않음 |
| P1 | 최신 DB E2E·coverage 기록 | 로컬 555개·93.48%, PR CI 재확인 |
| P2 | 실제 3사 Adapter | 별도 sandbox/운영 계약 검증 |
