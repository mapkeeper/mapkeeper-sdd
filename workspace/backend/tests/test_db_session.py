from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession

from mapkeeper.db.session import (
    dispose_engine,
    get_engine,
    get_session,
    get_session_factory,
)


def test_engine_uses_the_configured_async_postgres_dsn(database_url: str) -> None:
    # Given: DATABASE_URL from the environment.

    # When: the engine is created.
    engine = get_engine()

    # Then: it drives PostgreSQL through asyncpg without exposing the password.
    assert isinstance(engine, AsyncEngine)
    assert engine.dialect.name == "postgresql"
    assert engine.dialect.driver == "asyncpg"
    assert engine.url.render_as_string(hide_password=False) == database_url


def test_engine_is_created_once_per_process() -> None:
    # Given: no engine created yet.

    # When: the engine is requested twice.
    first = get_engine()
    second = get_engine()

    # Then: connections are pooled in a single shared engine.
    assert first is second


def test_session_factory_is_bound_to_the_engine_and_never_autoflushes() -> None:
    # Given: the shared session factory.
    factory = get_session_factory()

    # When: a session is built.
    session = factory()

    # Then: writes only reach the database when a unit of work commits explicitly.
    assert session.bind is get_engine()
    assert session.autoflush is False
    assert session.sync_session.expire_on_commit is False


@pytest.mark.asyncio
async def test_get_session_yields_one_session_and_closes_it() -> None:
    # Given: the request-scoped session dependency.
    dependency = get_session()

    # When: the request obtains and then releases the session.
    session = await anext(dependency)
    assert isinstance(session, AsyncSession)
    with pytest.raises(StopAsyncIteration):
        _ = await anext(dependency)

    # Then: no transaction is left open behind the request.
    assert not session.in_transaction()


@pytest.mark.asyncio
async def test_get_session_rolls_back_and_reraises_when_the_request_fails() -> None:
    # Given: a request that fails while holding a session.
    dependency = get_session()
    _ = await anext(dependency)

    # When: the failure propagates through the dependency.
    with (
        patch.object(AsyncSession, "rollback", autospec=True) as rollback,
        pytest.raises(RuntimeError, match="approval failed"),
    ):
        _ = await dependency.athrow(RuntimeError("approval failed"))

    # Then: partial writes are discarded and the caller still sees the error.
    _ = rollback.assert_awaited_once()


@pytest.mark.asyncio
async def test_dispose_engine_clears_the_cached_engine_and_factory() -> None:
    # Given: an engine and factory already built for this process.
    first = get_engine()
    _ = get_session_factory()

    # When: shutdown disposes the pool.
    await dispose_engine()

    # Then: the next caller gets a freshly built engine.
    assert get_engine() is not first


@pytest.mark.asyncio
async def test_dispose_engine_is_safe_before_any_engine_exists() -> None:
    # Given: a process that never opened a database connection.

    # When / Then: shutdown does not build an engine just to throw it away.
    await dispose_engine()
    assert get_engine.cache_info().currsize == 0
