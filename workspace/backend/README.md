# MapKeeper Backend

FastAPI 애플리케이션과 API Contract v0.2 기준 Pydantic schema, PostgreSQL 영속성 계층을 포함한다.

## 설정

`.env.example`을 `.env`로 복사한 뒤 값을 채운다. `.env`는 커밋하지 않는다.

| 변수 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN. `postgresql+asyncpg://` 드라이버만 허용한다. |
| `DB_ECHO` | SQL 로깅 여부. 기본값은 `false`다. |
| `MVP_ACTOR_ID` | 승인 주체 UUID. 로그인 없는 MVP에서 `approvedBy`로 사용한다. 요청 Body에서 받지 않는다. |
| `TEST_DATABASE_URL` | `tests/integration`이 사용하는 빈 DB. 없으면 해당 테스트를 건너뛴다. |

PostgreSQL은 Proxmox의 별도 LXC를 사용하며 Compose에 DB 컨테이너를 추가하지 않는다.
설정은 지연 로딩이므로 `DATABASE_URL`이 없어도 `/health`는 동작한다.

⚠️ `TEST_DATABASE_URL`은 반드시 버려도 되는 빈 DB를 가리켜야 한다. 해당 DB에는
migration이 적용되고 테스트가 데이터를 쓴다.

## 개발 환경 DB 접속

DB LXC(`192.168.219.43`)는 개발 PC와 다른 네트워크에 있어 Proxmox 호스트를 경유한다.

```bash
ssh -N -L 15432:192.168.219.43:5432 root@pve   # 별도 터미널에서 유지
```

터널을 띄운 상태에서 `DATABASE_URL`의 host를 `127.0.0.1:15432`로 지정한다.
백엔드를 같은 네트워크(`192.168.219.0/24`)에 배포하는 경우에는 터널 없이
LXC IP로 직접 접속한다.

## Migration

```bash
uv run --locked alembic upgrade head        # 실제 DB에 적용
uv run --locked alembic downgrade base      # 전체 되돌리기
uv run --locked alembic upgrade head --sql  # DB 연결 없이 SQL만 확인
```

`--sql` 오프라인 모드는 DB 접속 없이 생성될 DDL을 그대로 출력한다.

## Seed

migration 이후 시연용 매장 하나와 마스킹 완료 리뷰 세 건을 넣는다.

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

## API 계약

`openapi.json`이 프론트엔드에 전달하는 단일 계약이다. schema나 route를 바꾸면 다시 생성한다.

```bash
uv run --locked python -m mapkeeper.openapi
```

`tests/test_openapi.py`가 커밋된 파일과 앱이 서빙하는 문서를 비교하므로,
재생성을 잊으면 테스트가 실패한다.

v0.2 엔드포인트 10개는 모두 선언돼 있으나 핸들러 본문은 아직 없다.
호출하면 `501 Not Implemented`를 반환하며 T225와 T227~T234에서 구현한다.

## 검사

```bash
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked basedpyright
uv run --locked pytest --cov=mapkeeper --cov-report=term-missing
```
