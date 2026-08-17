# MapKeeper 개발·검증 Quickstart

> 상태: **Canonical commands / local FE·BE boundary verified**
> 기준 커밋: `206ad82198aa8c76652f3001ee6bd31d24cd360d`
> 최종 대조일: `2026-08-17`
> 담당: 백엔드 작성, 프론트엔드 공동 검증

## 1. 현재 구현 상태

### 구현됨

- FastAPI와 `/api/v1` 제품 Endpoint 11개
- UC1 Proposal create·patch·reject·approve
- UC2 INTRODUCTION·NEWS create·regenerate·reject·whole approve
- 공유 리뷰 요약 API와 마스킹 데모 리뷰 128건
- 공식 데모 StoreProfile: `만두전골 하우스`, `서울특별시 관악구 시연로 12`, 대표 메뉴 `만두전골`
- PostgreSQL·SQLAlchemy·Alembic head `0003`
- SyncJob·PlatformSyncTask·멱등성·상태 집계·재시작 복구
- Gemini 실제 HTTP adapter와 no-key Stub fallback
- React UI, Web Speech fallback, 리뷰·UC1·UC2·상태 화면
- GitHub Actions CI, GHCR, Ubuntu VM 배포

### 구현 또는 검증 격차

- Google·Naver·Kakao 실제 운영 API 발행: 시뮬레이션
- Polling 2초·60초 계약: 미구현
- retry 지수 백오프 실제 대기: 미구현
- PII 마스킹 범위: 보완 필요
- 새 FE·BE 계약 게이트의 원격 CI 결과: Pull Request에서 확인 필요

## 2. 사전 준비

- Node.js 24
- Python 3.11
- uv
- Docker Engine와 Compose plugin
- PostgreSQL 접속 정보
- 선택: Gemini API Key

저장소 루트:

```text
40_code/mapkeeper-sdd
```

## 3. 환경변수

### Backend 개발용 `workspace/backend/.env`

```dotenv
DATABASE_URL=postgresql+asyncpg://mapkeeper:<password>@<db-host>:5432/mapkeeper
TEST_DATABASE_URL=postgresql+asyncpg://mapkeeper:<password>@<test-db-host>:5432/mapkeeper_test
MVP_ACTOR_ID=00000000-0000-4000-8000-000000000000
DB_ECHO=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
GEMINI_TIMEOUT_SECONDS=20
```

### Compose용 `workspace/.env`

```dotenv
BACKEND_IMAGE=mapkeeper-backend:local
BACKEND_PORT=8000
DATABASE_URL=postgresql+asyncpg://mapkeeper:<password>@<db-host>:5432/mapkeeper
MVP_ACTOR_ID=00000000-0000-4000-8000-000000000000
DB_ECHO=false
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.6-flash
GEMINI_TIMEOUT_SECONDS=20

FRONTEND_IMAGE=mapkeeper-frontend:local
FRONTEND_BIND_ADDRESS=127.0.0.1
FRONTEND_PORT=3000
VITE_API_BASE_URL=
VITE_API_MOCKING=false
VITE_MOCK_SCENARIO=default
VITE_SHOW_DEVELOPER_TOOLS=false
```

Secret과 실제 비밀번호는 커밋하지 않는다. `TEST_DATABASE_URL`은 삭제 가능한 전용 DB만 가리켜야 한다.

## 4. Backend 실행

```bash
cd workspace/backend
uv sync --locked --all-groups
uv run --locked alembic upgrade head
uv run --locked python -m mapkeeper.db.seed
uv run uvicorn mapkeeper.main:app --app-dir src --reload --host 127.0.0.1 --port 8000
```

확인:

```bash
curl http://127.0.0.1:8000/health
```

예상:

```json
{"status":"ok"}
```

## 5. Frontend 실행

```bash
cd workspace/frontend
npm ci
npm run dev -- --host 127.0.0.1 --port 5173
```

브라우저에서 `http://127.0.0.1:5173/`로 접속한다. 실제 backend를 사용할 때 `VITE_API_MOCKING=false`를 확인한다.

## 6. 품질 검사

### Backend

```bash
cd workspace/backend
uv run --locked python -m mapkeeper.openapi
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked basedpyright
uv run --locked pytest --cov=mapkeeper --cov-report=term-missing --cov-fail-under=90
```

### Frontend

```bash
cd workspace/frontend
npm ci
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## 7. 현재 검증 기록

| 항목 | 현재 기준 결과 |
|---|---|
| 기준 SHA | `206ad82198aa8c76652f3001ee6bd31d24cd360d` |
| Frontend tests | 18 files, **110 passed** |
| Actual FE·BE contract | 1 file, **3 passed** — 리뷰 공유·UC1 구조·UC2 근거 |
| Frontend lint/typecheck/build | passed |
| Current local backend | **555 passed**, **93.48%** — PostgreSQL 16, skip 0 |
| Latest successful CI backend | **553 passed**, **93.57%** — SHA `3b1b977...` |
| Backend Ruff/basedpyright | passed |
| Coverage gate | CI `>= 90%` |
| OpenAPI | 11 `/api/v1` operations, 12 paths including `/health` |
| Migration | `0003 (head)` |
| Seed | StoreProfile 1건, SourceReview 128건 |

최신 성공 CI: <https://github.com/mapkeeper/mapkeeper-sdd/actions/runs/31945560292>
최신 성공 배포: <https://github.com/mapkeeper/mapkeeper-sdd/actions/runs/31946194685>

위 원격 기록은 SHA `3b1b977...`의 증빙이다. 555개·93.48%는 현재 브랜치 작업 트리의 로컬 PostgreSQL 16 실행 결과이며, 새 계약 게이트와 함께 Pull Request CI에서 다시 확인한다. DB 연결 실패로 skip 또는 error가 발생한 실행은 전체 통과로 기록하지 않는다.

## 8. 주요 E2E 시나리오

```bash
cd workspace/backend
uv run --locked pytest tests/integration/test_uc_e2e.py -v
```

| 시나리오 | 기대 결과 |
|---|---|
| UC1 생성→승인→조회 | 201 → 202 → SUCCESS |
| UC2 생성→재생성→승인→조회 | revision 증가 → 202 → SUCCESS |
| 부분 성공 | PARTIAL_SUCCESS, retryable 실패만 재시도 |
| 전체 실패 | FAILED, 비재시도 오류는 버튼 없음 |
| 멱등성 replay | 같은 키·같은 승인에 같은 SyncJob |
| 멱등성 conflict | 같은 키·다른 승인에 409 |
| 리뷰 요약 | 전체 128건, 대표 sourceReviews 최대 10건 |

## 9. Docker Compose

저장소 루트에서 실행한다.

```bash
docker compose -f workspace/compose.yaml config --quiet
docker compose -f workspace/compose.yaml up --build -d --wait
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:3000/healthz
```

PostgreSQL은 Compose에 포함하지 않는다.

## 10. CI/CD

### CI

- Frontend lint·typecheck·test·build
- PostgreSQL 16 service container
- Alembic migration
- Backend Ruff·basedpyright·pytest coverage 90%
- Compose config와 frontend/backend 이미지 빌드

### Deploy development

1. backend·frontend 이미지를 GHCR에 commit SHA와 `development` tag로 발행한다.
2. GitHub OIDC 기반 Tailscale로 Ubuntu VM에 접속한다.
3. Compose 설정을 검증한다.
4. 새 backend 이미지로 migration을 실행한다.
5. 데모 seed를 멱등하게 적용한다.
6. 새 이미지를 기동하고 backend/frontend health를 확인한다.
7. 실패하면 이전 컨테이너 이미지로 롤백한다.

Migration은 이전 애플리케이션 버전과 호환되게 단계적으로 작성한다. 컨테이너 롤백이 DB schema를 자동으로 되돌리지는 않는다.

## 11. 외부 연동 상태

| 영역 | 구현 | 검증 상태 |
|---|---|---|
| PostgreSQL | 실제 LXC 연결 | 배포 환경 사용 중, 최신 E2E 재기록 필요 |
| Gemini | 실제 HTTP adapter + Stub | 키 설정 여부에 따라 분기, live evidence 별도 기록 |
| Google 발행 | AcceptingAdapter | Simulated |
| Naver 발행 | AcceptingAdapter | Simulated |
| Kakao 발행 | AcceptingAdapter | Simulated |

## 12. PPT 대표 증빙

### UC1 구조화 응답

```json
{
  "success": true,
  "status": "SUCCESS",
  "data": {
    "changes": [{
      "field": "businessHours",
      "currentValue": {"open": "09:00", "close": "22:00"},
      "proposedValue": {"open": "09:00", "close": "21:00"}
    }],
    "status": "DRAFT"
  }
}
```

프론트 서비스는 위 실제 응답을 `09:00-22:00 → 09:00-21:00`으로 표시하며 객체를 React 자식으로 직접 렌더링하지 않는다.

### UC2 전체 승인

```json
{
  "success": true,
  "status": "PROCESSING",
  "data": {
    "generationStatus": "APPROVED",
    "approvedPlatforms": ["google", "naver", "kakao"],
    "status": "PENDING"
  }
}
```

승인 요청 Body와 `draftIds`는 없다. 세 플랫폼 발행 결과는 현재 외부 API 호출이 아닌 `AcceptingAdapter` 시뮬레이션이다.

### 리뷰 근거

```json
{
  "reviewCount": 128,
  "sourceReviewCount": 10
}
```

UC2는 대상 StoreProfile 소유이며 마스킹 완료된 `sourceReviewIds`만 생성 입력으로 허용한다.
