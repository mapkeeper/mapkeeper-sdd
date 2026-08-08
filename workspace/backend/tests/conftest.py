from collections.abc import Iterator
from pathlib import Path
from typing import Final
from uuid import UUID

import pytest

from mapkeeper.core.config import get_settings
from mapkeeper.db.session import get_engine, get_session_factory

BACKEND_ROOT: Final = Path(__file__).resolve().parents[1]
TEST_DATABASE_URL: Final = "postgresql+asyncpg://mapkeeper:local@127.0.0.1:5432/mapkeeper_test"
TEST_ACTOR_ID: Final = "99999999-9999-4999-8999-999999999999"


def _clear_caches() -> None:
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()


@pytest.fixture(autouse=True)
def isolated_settings(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Give every test a known DATABASE_URL and no leaked settings or engine cache."""
    monkeypatch.setenv("DATABASE_URL", TEST_DATABASE_URL)
    monkeypatch.setenv("MVP_ACTOR_ID", TEST_ACTOR_ID)
    monkeypatch.delenv("DB_ECHO", raising=False)
    _clear_caches()
    yield
    _clear_caches()


@pytest.fixture
def database_url() -> str:
    """Return the DSN every test runs against."""
    return TEST_DATABASE_URL


@pytest.fixture
def actor_id() -> UUID:
    """Return the fixed MVP approver every approval is attributed to."""
    return UUID(TEST_ACTOR_ID)


@pytest.fixture
def backend_root() -> Path:
    """Return the backend project root that holds alembic.ini."""
    return BACKEND_ROOT
