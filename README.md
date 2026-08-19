# MapKeeper (맵지기AI)

소상공인이 매장 정보를 여러 지도 플랫폼(Google·네이버·카카오)에 일일이 반영하고, 쌓인 리뷰를 읽어 홍보문구까지 쓰는 데 드는 시간을 줄이기 위한 서비스다. 음성 또는 텍스트로 한 번만 요청하면 승인 절차를 거쳐 플랫폼별 반영을 준비하고, 리뷰를 분석해 AI 홍보문구 초안을 생성한다.

기획 문서와 개발 중인 애플리케이션을 함께 관리하는 저장소다. 최종 제출 시에는 `workspace/`의 필요한 산출물만 제출용 저장소로 이전한다.

## 핵심 기능

### UC1 — 매장 정보 변경
영업시간·임시 휴무·대표 메뉴명 3개 필드만 음성 또는 텍스트로 변경 요청할 수 있다. 요청은 곧바로 반영되지 않고 변경안(Proposal)으로 만들어지며, 사장님이 승인해야 `SyncJob`이 생성되어 Google·네이버·카카오 3개 플랫폼에 반영을 시도한다. 실패·재시도 가능한 플랫폼은 최대 3회까지 자동 재시도한다.

### UC2 — AI 홍보문구 생성
매장 리뷰를 Gemini에 전달해 3개 플랫폼용 홍보문구를 한 번의 호출로 함께 생성한다. 문구는 750자, 키워드는 1~10개(개당 30자)로 제한되며 저장 전에 스키마로 재검증해 규칙을 어기면 거절한다. `GEMINI_API_KEY`가 없으면 결정적 stub이 대신 동작해 외부 서비스 없이도 시연할 수 있다. 리뷰 인사이트 화면에서 곧바로 "이 분석으로 AI 홍보문구 만들기" 버튼으로 넘어갈 수 있다.

### 안전장치
- **승인 기반 실행** — UC1·UC2 모두 AI/사용자 요청이 즉시 반영되지 않고, 사장님의 명시적 승인 후에만 플랫폼 반영·발행이 이뤄진다.
- **PII 마스킹** — 리뷰 텍스트를 Gemini에 보내기 전에 전화번호·주소·고객명을 정규식으로 결정적으로 마스킹한다(`[MASKED_PHONE]` 등).
- **음성 원본 미전송·미저장** — 브라우저 내장 Web Speech API로 변환된 텍스트만 사용하고, 오디오 원본은 서버로 전송하거나 저장하지 않는다.
- **출력 재검증** — Gemini 응답은 저장 전 Pydantic 스키마로 재검증하고, 실패 메시지는 벤더·엔드포인트·키를 노출하지 않는다.

> ⚠️ Google·네이버·카카오 실 연동은 아직 없다. 현재 `AcceptingAdapter`가 외부 호출 없이 성공·실패·재시도 흐름만 재현하는 **시뮬레이션**이며, 실제 플랫폼에 반영되는 것으로 해석하지 않는다.

## 기술 스택

| 영역 | 구성 |
|---|---|
| Backend | FastAPI, SQLAlchemy(async), PostgreSQL, Alembic |
| Frontend | React, TypeScript, Vite |
| AI | Gemini API (REST, 재시도·타임아웃 포함 커스텀 클라이언트) |
| 계약 | OpenAPI로 프론트·백엔드 간 단일 계약 관리 |
| CI/CD | GitHub Actions, GHCR, Tailscale SSH 배포 |

## 저장소 구조

```text
docs/sdd/                          설계 기준 문서(SDD) 10종 — 최종 제출 산출물은 아님

workspace/
├── backend/
│   ├── src/mapkeeper/
│   │   ├── api/          라우트(routes/)와 요청·응답 schema(schemas/)
│   │   ├── adapters/      Gemini·플랫폼 어댑터 (Protocol 경계)
│   │   ├── core/          설정, 로깅, 에러 코드
│   │   ├── db/             모델, 세션, seed
│   │   ├── models/        SQLAlchemy ORM 모델
│   │   └── services/       PII 마스킹 등 도메인 서비스
│   └── openapi.json        프론트엔드에 전달하는 단일 API 계약
├── frontend/
│   └── src/
│       ├── components/    화면 구성 요소
│       ├── features/       UC1/UC2 등 기능 단위 모듈
│       ├── hooks/           useSpeechRecognition 등
│       └── services/        API 클라이언트, 진단
├── compose.yaml            로컬·개발 서버 실행 설정
└── .env.example             공개 가능한 환경변수 예시

.github/workflows/
├── ci.yml          코드 검사·테스트·컨테이너 빌드
└── deploy.yml      GHCR 발행·Ubuntu VM 수동 배포
```

## 로컬 품질 검사

```bash
cd workspace/backend
uv sync --locked --all-groups
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked basedpyright
uv run --locked pytest --cov=mapkeeper --cov-report=term-missing --cov-fail-under=90

cd ../frontend
npm ci
npm run lint
npm run typecheck
npm run test:run
npm run build
```

## Docker 실행

```bash
docker compose -f workspace/compose.yaml up --build -d
curl http://127.0.0.1:8000/health
docker compose -f workspace/compose.yaml down
```

정상 응답은 다음과 같다.

```json
{"status":"ok"}
```

## CI

Pull Request와 `main` 브랜치 Push에서 다음 항목을 검사한다.

- Ruff 포맷과 린트
- basedpyright 엄격 타입 검사
- pytest 및 커버리지
- 실제 FastAPI와 프론트 서비스 사이의 UC1·UC2 계약 회귀
- Compose 설정
- 프론트엔드·백엔드 Docker 이미지 빌드

## 개발 서버 수동 배포

GitHub 저장소의 `development` Environment에 다음 Secret을 등록한다.

| Secret | 값 |
|---|---|
| `DEPLOY_HOST` | Ubuntu VM 주소 |
| `DEPLOY_USER` | Docker 실행 권한이 있는 배포 사용자 |
| `DEPLOY_SSH_KEY` | 배포 전용 SSH 개인키 |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan`으로 사전에 확인한 VM 호스트 키 |

Ubuntu VM에는 Docker Engine, Docker Compose 플러그인, `curl`이 설치되어 있어야 한다. GitHub Actions의 **Deploy development** 워크플로를 수동 실행하면 다음 작업을 수행한다.

1. 프론트엔드·백엔드 이미지를 커밋 SHA로 태그해 GHCR에 발행한다.
2. Tailscale OIDC로 Ubuntu VM에 접속한다.
3. Compose 설정을 전송하고 migration·데모 seed를 적용한다.
4. 새 이미지를 실행하고 두 컨테이너의 health를 확인한다.
5. 실패하면 직전 이미지로 롤백한다.

PostgreSQL LXC와 Gemini 키는 서버 환경변수로 관리하며 저장소에 커밋하지 않는다.

## 외부 플랫폼 연동 범위

Google·Naver·Kakao 발행은 현재 `AcceptingAdapter`가 외부 호출 없이 성공·실패·재시도 흐름을 재현하는 **시뮬레이션**이다. 실제 운영 API에 등록하거나 수정한 것으로 해석하지 않는다. 실제 연동을 도입할 때에는 Constitution·Specify·API Contract를 먼저 개정한다.
