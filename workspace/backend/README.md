# MapKeeper Backend

FastAPI 애플리케이션과 API Contract v0.2 기준 Pydantic schema, PostgreSQL 영속성 계층을 포함한다.

## 설정

`.env.example`을 `.env`로 복사한 뒤 값을 채운다. `.env`는 커밋하지 않는다.

| 변수 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN. `postgresql+asyncpg://` 드라이버만 허용한다. |
| `DB_ECHO` | SQL 로깅 여부. 기본값은 `false`다. |
| `MVP_ACTOR_ID` | 승인 주체 UUID. 로그인 없는 MVP에서 `approvedBy`로 사용한다. 요청 Body에서 받지 않는다. |
| `GEMINI_API_KEY` | 선택. 없으면 UC2 문구 생성이 결정적 stub으로 동작한다. |
| `GEMINI_MODEL` | 기본 `gemini-3.6-flash`. |
| `TEST_DATABASE_URL` | `tests/integration`이 사용하는 빈 DB. 없으면 해당 테스트를 건너뛴다. |

PostgreSQL은 Proxmox의 별도 LXC를 사용하며 Compose에 DB 컨테이너를 추가하지 않는다.
설정은 지연 로딩이므로 `DATABASE_URL`이 없어도 `/health`는 동작한다.

⚠️ `TEST_DATABASE_URL`은 반드시 버려도 되는 빈 DB를 가리켜야 한다. 해당 DB에는
migration이 적용되고 테스트가 데이터를 쓴다.

## 개발 환경 DB 접속

DB LXC(`<DB_LXC_IP>`)는 개발 PC와 다른 네트워크에 있어 Proxmox 호스트를 경유한다.

```bash
ssh -N -L 15432:<DB_LXC_IP>:5432 root@pve   # 별도 터미널에서 유지
```

터널을 띄운 상태에서 `DATABASE_URL`의 host를 `127.0.0.1:15432`로 지정한다.
백엔드를 같은 네트워크에 배포하는 경우에는 터널 없이 LXC IP로 직접 접속한다.

## Migration

```bash
uv run --locked alembic upgrade head        # 실제 DB에 적용
uv run --locked alembic downgrade base      # 전체 되돌리기
uv run --locked alembic upgrade head --sql  # DB 연결 없이 SQL만 확인
```

`--sql` 오프라인 모드는 DB 접속 없이 생성될 DDL을 그대로 출력한다.

배포 시에는 GitHub Actions가 새 이미지를 pull한 뒤, 컨테이너를 올리기 **전에**
같은 이미지로 migration을 적용한다.

```bash
docker compose run --rm --no-deps backend alembic upgrade head
```

migration 파일이 이미지에 함께 들어 있어 스키마와 코드의 커밋이 항상 일치한다.
migration이 실패하면 배포가 중단되고 이전 이미지로 롤백된다.

⚠️ **migration은 직전 릴리스와 호환되어야 한다.** 배포가 migration 이후 단계에서
실패하면 컨테이너만 롤백되고 스키마는 적용된 상태로 남는다. 컬럼·테이블 추가는
안전하지만 삭제·이름 변경은 두 단계로 나눠야 한다.

## Seed

migration 이후 공식 시연용 매장 `만두전골 하우스` 하나와 마스킹 완료 리뷰 128건을 넣는다.

```bash
uv run --locked python -m mapkeeper.db.seed
```

고정 UUID를 사용하므로 여러 번 실행해도 중복되지 않는다. 이미 있으면 아무것도 쓰지 않는다.
UC1과 UC2를 서로 없이도 시연할 수 있는 최소 데이터다.

seed에는 고객 PII와 Secret 원문이 없다. `platformAccountRefs`에는 공개 계정 ID와
`sm://` 참조만 넣고 OAuth Token이나 API Secret은 저장하지 않는다.

## 요청 추적과 멱등성

모든 응답은 `X-Request-ID`를 돌려준다. 클라이언트가 보내지 않았거나 값이 길거나
허용 문자를 벗어나면 서버가 새로 만들어 사용한다. 반사하지 않는다.

로그 한 줄마다 이 값이 들어가므로 요청 → SyncJob → PlatformSyncTask를 한 번의
검색으로 따라갈 수 있다. `Idempotency-Key` 전체 값은 로그에 남기지 않고
12자 fingerprint로만 기록한다.

승인 멱등성은 `approvedBy + Idempotency-Key`로 관리한다. 같은 요청이면 기존
SyncJob을 그대로 돌려주고, 같은 키가 다른 승인 대상에 쓰이면 `409
IDEMPOTENCY_CONFLICT`다. 같은 요청인지는 SHA-256으로 판별한다.

- UC1: proposal id + 승인되는 changes
- UC2: generation id + 승인되는 revision

재생성으로 revision이 올라가면 같은 키라도 다른 요청이 된다.

## 플랫폼 동기화

승인 결과는 `SyncJob` 하나와 플랫폼별 `PlatformSyncTask` 세 개로 처리한다.

- **Adapter 경계** — 외부 플랫폼은 `adapters/`의 Protocol을 통해서만 호출한다. 실패는
  6개 계약 오류 코드 중 하나로 정규화되며, 벤더 응답·토큰·서명은 밖으로 나오지 않는다.
  timeout·429·5xx만 재시도 가능하다.
- **현재 어댑터** — Google·Naver·Kakao 클라이언트가 아직 없어 `AcceptingAdapter`가
  외부 호출 없이 성공을 반환하는 시뮬레이션이다. 실제 운영 반영으로 해석하지 않는다.
- **재시도** — 실패했고 재시도 가능한 플랫폼만 최대 3회 다시 시도한다. 2·4·8초
  `nextRetryAt`은 기록하지만 실제 대기는 아직 적용하지 않았다. 성공한 플랫폼은 다시 실행하지 않는다.
- **재시작 복구** — BackgroundTasks는 프로세스 재시작을 넘기지 못하므로, 기동 시
  `PROCESSING`·`RETRYING`으로 남은 Task를 재시도 가능한 `FAILED`로 정리한다.

## UC2 문구 생성

`GEMINI_API_KEY`가 있으면 Gemini를 호출하고, 없으면 결정적 stub이 동작한다.
시연이 외부 서비스 가용성에 묶이지 않도록 폴백을 유지한다.

- 한 번의 호출로 3사 결과를 함께 받는다. 호출 횟수를 줄여 비용과 응답 지연을
  최소화하기 위해서다.
- 모델 출력은 저장 전에 `PlatformContentResult` schema로 재검증한다. 길이·키워드
  개수·플랫폼 커버리지를 지키지 않으면 거절한다.
- 프롬프트에는 마스킹된 값만 들어간다. 실패 메시지는 provider·endpoint·key를
  드러내지 않는다.

운영 환경은 유료 티어를 사용한다. Google의 유료 티어 정책상 전송 데이터는
모델 재학습이나 제품 개선에 사용되지 않는다.

## API 계약

`openapi.json`이 프론트엔드에 전달하는 단일 계약이다. schema나 route를 바꾸면 다시 생성한다.

```bash
uv run --locked python -m mapkeeper.openapi
```

`tests/test_openapi.py`가 커밋된 파일과 앱이 서빙하는 문서를 비교하므로,
재생성을 잊으면 테스트가 실패한다.

제품 엔드포인트 11개는 모두 선언되어 있으며 UC1·UC2 생성, 리뷰 요약 및 동기화 흐름과
SyncJob 상태·재시도 핸들러가 구현되어 있다. 계약을 바꾸면 OpenAPI를 재생성하고
전체 검사 명령을 실행한다.

## 검사

```bash
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked basedpyright
uv run --locked pytest --cov=mapkeeper --cov-report=term-missing
```

## CI 검증

GitHub Actions의 Backend quality gate는 PostgreSQL 16 서비스 컨테이너를 띄우고
`DATABASE_URL`, `TEST_DATABASE_URL`, `MVP_ACTOR_ID`를 테스트 전용 값으로 주입한다.
그 다음 `uv run --locked alembic upgrade head`로 빈 데이터베이스를 준비한 뒤
포맷·린트·타입 검사와 전체 테스트를 실행한다. 현재 커버리지 기준은 90%다.

로컬에서 배포 환경을 확인할 때는 PostgreSQL LXC 터널을 유지한 상태로 다음 명령을
순서대로 실행한다.

```bash
uv run --locked alembic upgrade head
uv run --locked python -m mapkeeper.db.seed
uv run --locked pytest --cov=mapkeeper --cov-report=term-missing
```
