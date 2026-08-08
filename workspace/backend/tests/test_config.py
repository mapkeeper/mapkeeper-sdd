import pytest
from pydantic import ValidationError

from mapkeeper.core.config import Settings, get_settings


def test_settings_read_the_database_url_from_the_environment(database_url: str) -> None:
    # Given: DATABASE_URL is exported by the test environment.

    # When: settings are resolved.
    settings = get_settings()

    # Then: the configured PostgreSQL DSN is used as-is.
    assert str(settings.database_url) == database_url


def test_db_echo_defaults_to_off(database_url: str) -> None:
    # Given: only a database URL, with no local .env overrides.

    # When: settings are built.
    settings = Settings(database_url=database_url, _env_file=None)  # pyright: ignore[reportCallIssue]

    # Then: SQL statement logging stays off so no query text leaks by default.
    assert settings.db_echo is False


def test_settings_are_resolved_only_once(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given: settings already resolved from the current environment.
    first = get_settings()

    # When: the environment changes afterwards.
    monkeypatch.setenv("DATABASE_URL", "postgresql+asyncpg://other:other@127.0.0.1:5432/other")

    # Then: the process keeps the settings it started with.
    assert get_settings() is first


@pytest.mark.parametrize(
    "dsn",
    [
        "postgresql://mapkeeper:local@127.0.0.1:5432/mapkeeper",
        "postgresql+psycopg://mapkeeper:local@127.0.0.1:5432/mapkeeper",
    ],
)
def test_settings_reject_a_synchronous_postgres_driver(dsn: str) -> None:
    # Given: a DSN that would open blocking connections inside the event loop.

    # When / Then: configuration fails instead of degrading at runtime.
    with pytest.raises(ValidationError, match=r"postgresql\+asyncpg"):
        _ = Settings(database_url=dsn, _env_file=None)  # pyright: ignore[reportCallIssue]


def test_settings_reject_a_non_postgres_database_url() -> None:
    # Given: a DSN for a database MapKeeper does not support.

    # When / Then: configuration fails before an engine is built.
    with pytest.raises(ValidationError):
        _ = Settings(database_url="sqlite+aiosqlite:///./mapkeeper.db", _env_file=None)  # pyright: ignore[reportCallIssue]


def test_settings_require_a_database_url(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given: no DATABASE_URL supplied by the environment or a dotenv file.
    monkeypatch.delenv("DATABASE_URL", raising=False)

    # When / Then: startup configuration fails loudly instead of guessing a default.
    with pytest.raises(ValidationError):
        _ = Settings(_env_file=None)  # pyright: ignore[reportCallIssue]
