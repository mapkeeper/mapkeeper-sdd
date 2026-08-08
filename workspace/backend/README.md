# MapKeeper Backend

FastAPI 애플리케이션과 API Contract v0.2 기준 Pydantic schema, PostgreSQL 영속성 계층을 포함한다.

## 설정

`.env.example`을 `.env`로 복사한 뒤 값을 채운다. `.env`는 커밋하지 않는다.

| 변수 | 설명 |
|---|---|
| `DATABASE_URL` | PostgreSQL DSN. `postgresql+asyncpg://` 드라이버만 허용한다. |
| `DB_ECHO` | SQL 로깅 여부. 기본값은 `false`다. |

PostgreSQL은 Proxmox의 별도 LXC를 사용하며 Compose에 DB 컨테이너를 추가하지 않는다.
설정은 지연 로딩이므로 `DATABASE_URL`이 없어도 `/health`는 동작한다.

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
