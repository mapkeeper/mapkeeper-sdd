# MapKeeper 통합 TASK

> 상태: **Canonical task index**
> 기준 커밋: `206ad82198aa8c76652f3001ee6bd31d24cd360d`
> 최종 대조일: `2026-08-17`
> 담당: PM 관리, 각 영역 담당자가 상태 갱신

## 상태 표기

| 상태 | 의미 |
|---|---|
| Done | 코드와 기본 자동 검증 존재 |
| Done with gap | 주요 구현은 있으나 계약 일부 미충족 |
| Verification needed | 구현은 있으나 현재 기준 증거 갱신 필요 |
| In progress | 현재 작업 중 |
| Planned | 구현되지 않음 |

## 1. 계약과 데이터

| ID | 담당 | 작업 | 상태 | 근거 |
|---|---|---|---|---|
| T200 | 전원 | MVP 범위·승인 단위 확정 | Done | Constitution·Specify |
| T201 | 백엔드 | 입력 제한·콘텐츠 규칙 확정 | Done | API schemas |
| T202 | 전원 | 상태·오류·재시도 UX 문구 | Done with gap | Polling gap |
| T203 | 전원 | API Contract 공유 | Done | 새 API·purpose 포함 기준본 작성 |
| T204~T210 | FE·BE | 공통 Enum·UC1/UC2 schema·OpenAPI | Done with gap | FE runtime parsing 보완 필요 |
| T211 | FE·BE | fixture·Mock 계약 | Done | MSW fixture 사용 |
| T212~T217 | 백엔드 | PostgreSQL·ORM·migration·seed | Done | migration `0003`, 리뷰 128건 |

## 2. 공통 처리와 UC1

| ID | 담당 | 작업 | 상태 | 근거 |
|---|---|---|---|---|
| T218 | 백엔드 | Request ID·안전 로그 | Done with gap | 예상 밖 예외 로그 재검토 필요 |
| T219 | 백엔드 | 멱등성 replay·conflict | Done | 승인 서비스·DB Unique |
| T220~T221 | 백엔드 | UC1·UC2 승인 원자 트랜잭션 | Done | row lock·commit 후 runner |
| T222~T223 | 백엔드 | Adapter 오류 정규화·상태 집계 | Done | unit/integration tests |
| T224 | 백엔드 | 최대 3회 지수 백오프 | **Done with gap** | `nextRetryAt` 미준수 |
| T225~T226 | 백엔드 | 상태 API·retry·재시작 복구 | Done | SyncJob services |
| T227 | 백엔드 | Proposal create·patch·reject | Done | UC1 routes |
| T228 | 백엔드 | PII 마스킹·Gemini 구조화 | **Done with gap** | 마스킹 범위 보완 필요 |
| T229 | 백엔드 | Proposal approve | Done | approve route |
| T230~T231 | 프론트엔드 | 음성 fallback·UC1 Wizard | Done | frontend flow |

## 3. UC2와 상태 화면

| ID | 담당 | 작업 | 상태 | 근거 |
|---|---|---|---|---|
| T232~T234 | 백엔드 | 3사 생성·재생성·거절·전체 승인 | Done | SEO routes/services |
| T235~T236 | 프론트엔드 | 3사 결과·재생성·거절·전체 승인 | Done | SEO Wizard |
| T237 | 프론트엔드 | 2초 Polling·60초 중단·다시 확인 | **Planned** | 현재 무기한 100~500ms |
| T238 | 프론트엔드 | 플랫폼 오류·retryable UI | Done | SyncStatus |
| T239 | 백엔드 | UC1·UC2 E2E API 테스트 | Done | PostgreSQL 16에서 555개·93.48% |
| T240 | 전원 | 실제 FE·BE 계약 통합 | Done with gap | 실제 FastAPI 회귀 추가, 런타임 schema 보완 필요 |

## 4. 후속 구현으로 추가된 범위

| ID | 담당 | 작업 | 상태 | 근거 |
|---|---|---|---|---|
| T246 | 전원 | `INTRODUCTION`·`NEWS` 목적 분리 | Done | migration `0003`, UI |
| T247 | 백엔드 | 공유 리뷰 요약 API | Done | review route |
| T248 | 백엔드 | 마스킹 데모 리뷰 128건 seed | Done | seed tests |
| T249 | 프론트엔드 | 목적별 인터뷰·빠른 시작·답변 수정 | Done | SEO Wizard |
| T250 | 프론트엔드 | 새소식 기간 추출·달력 확인 | Done | NEWS flow |
| T251 | 전원 | 홈과 UC2 리뷰 데이터 통합 | Done | App shared state |

## 5. 배포·문서·남은 우선 과제

| ID | 담당 | 작업 | 상태 |
|---|---|---|---|
| T241 | 전원 | 최신 배포에서 최종 시연 점검 | Verification needed |
| T242 | 백엔드 | Quickstart 명령·수치·SHA 갱신 | Done |
| T243 | 백엔드 | Compose·LXC·배포 환경 연결 | Done |
| T244 | 프론트엔드 | lint·typecheck·test·build 검증 | Done, 110 tests |
| T245 | 전원 | 문서 정합성 최종 검수 | Done |
| T252 | 프론트엔드 | 2초·60초 Polling 구현 | Planned |
| T253 | 백엔드 | 실제 retry backoff 실행 | Planned |
| T254 | 백엔드 | PII 마스킹·로그 경계 강화 | Planned |
| T255 | FE·BE | 실제 FastAPI 기반 FE 계약 자동 검증 | **Implemented / PR CI pending** |

세부 작업은 `tasks-frontend.md`, `tasks-backend.md`에서 관리한다.
