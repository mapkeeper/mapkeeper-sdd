# MapKeeper Backend

FastAPI 애플리케이션과 API Contract v0.2 기준 Pydantic schema, PostgreSQL 영속성 계층을 포함한다.

## 설정

`.env.example`을 `.env`로 복사한 뒤 값을 채운다. `.env`는 커밋하지 않는다.

| 변수 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN. `postgresql+asyncpg://` 드라이버만 허용한다. |
| `DB_ECHO` | SQL 로깅 여부. 기본값은 `false`다. |
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

## 검사

```bash
uv run --locked ruff format --check .
uv run --locked ruff check .
uv run --locked basedpyright
uv run --locked pytest --cov=mapkeeper --cov-report=term-missing
```
