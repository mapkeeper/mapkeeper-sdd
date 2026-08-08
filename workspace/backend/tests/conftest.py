from collections.abc import Iterator
from pathlib import Path
from typing import Final

import pytest

from mapkeeper.core.config import get_settings
from mapkeeper.db.session import get_engine, get_session_factory

BACKEND_ROOT: Final = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL: Final = "postgresql+asyncpg://mapkeeper:local@127.0.0.1:5432/mapkeeper_test"


def _clear_caches() -> None:
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Give every test a known DATABASE_URL and no leaked settings or engine cache."""
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.delenv("DB_ECHO", raising=False)
    _clear_caches()
    yield
    _clear_caches()


@pytest.fixture
def database_url() -> str:
    """Return the DSN every test runs against."""
    return TEST_DATABASE_URL


@pytest.fixture
def backend_root() -> Path:
    """Return the backend project root that holds alembic.ini."""
    return BACKEND_ROOT
