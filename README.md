# MapKeeper 작업 저장소

기획 문서와 개발 중인 애플리케이션을 함께 관리한다. 최종 제출 시에는 `workspace/`의 필요한 산출물만 제출용 저장소로 이전한다.

## 현재 구성

```text
workspace/
├── backend/        FastAPI와 Dockerfile
├── compose.yaml    로컬·개발 서버 실행 설정
└── .env.example    공개 가능한 환경변수 예시

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
uv run --locked pytest --cov=mapkeeper --cov-report=term-missing --cov-fail-under=100
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
- Compose 설정
- 백엔드 Docker 이미지 빌드

## 개발 서버 수동 배포

GitHub 저장소의 `development` Environment에 다음 Secret을 등록한다.

| Secret | 값 |
|---|---|
| `DEPLOY_HOST` | Ubuntu VM 주소 |
| `DEPLOY_USER` | Docker 실행 권한이 있는 배포 사용자 |
| `DEPLOY_SSH_KEY` | 배포 전용 SSH 개인키 |
| `DEPLOY_KNOWN_HOSTS` | `ssh-keyscan`으로 사전에 확인한 VM 호스트 키 |

Ubuntu VM에는 Docker Engine, Docker Compose 플러그인, `curl`이 설치되어 있어야 한다. GitHub Actions의 **Deploy development** 워크플로를 수동 실행하면 다음 작업을 수행한다.

1. 백엔드 이미지를 커밋 SHA로 태그한다.
2. 이미지를 GHCR에 발행한다.
3. Compose 설정을 Ubuntu VM의 `~/mapkeeper`에 전송한다.
4. 새 이미지를 실행한다.
5. `GET /health`가 성공하는지 확인한다.

PostgreSQL LXC, Gemini 키, 3사 API 인증정보는 기능 구현 단계에서 서버의 환경변수로 추가하며 저장소에 커밋하지 않는다.
