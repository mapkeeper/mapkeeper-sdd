"""Checks the seed command itself: it commits, and running it again is safe.

Unlike the other integration checks this one commits, so it removes the demo rows
afterwards. It must only ever point at the disposable TEST_DATABASE_URL database.
"""

import asyncio
from collections.abc import AsyncGenerator

import pytest
import pytest_asyncio
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from mapkeeper.core.config import get_settings
from mapkeeper.db.seed import DEMO_STORE_PROFILE_ID, main, run
from mapkeeper.db.session import get_engine, get_session_factory

pytestmark = pytest.mark.asyncio


async def _delete_demo_rows(url: str) -> None:
    engine = create_async_engine(url, poolclass=NullPool)
    try:
        async with engine.begin() as connection:
            _ = await connection.execute(
                text("DELETE FROM store_profile WHERE id = :profile_id"),
                {"profile_id": DEMO_STORE_PROFILE_ID},
            )
    finally:
        await engine.dispose()


@pytest_asyncio.fixture
async def committed_seed_target(
    integration_database_url: str,
    monkeypatch: pytest.MonkeyPatch,
) -> AsyncGenerator[str, None]:
    """Point the application settings at the disposable database and clean up after."""
    monkeypatch.setenv("DATABASE_URL", integration_database_url)
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()
    await _delete_demo_rows(integration_database_url)
    try:
        yield integration_database_url
    finally:
        await _delete_demo_rows(integration_database_url)


async def test_the_seed_command_commits_its_work(committed_seed_target: str) -> None:
    # Given: a database with no demo rows.

    # When: the seed command runs.
    result = await run()

    # Then: the demo store survives the transaction it was created in.
    assert result.created_store_profile is True
    assert result.changed is True

    engine = create_async_engine(committed_seed_target, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            stored = await connection.execute(
                text("SELECT store_name FROM store_profile WHERE id = :profile_id"),
                {"profile_id": DEMO_STORE_PROFILE_ID},
            )
            assert stored.first() is not None
    finally:
        await engine.dispose()


async def test_running_the_seed_command_twice_is_safe(committed_seed_target: str) -> None:
    # Given: an already seeded database.
    assert committed_seed_target
    first = await run()
    assert first.changed is True

    # When: an operator runs the command again.
    second = await run()

    # Then: nothing is duplicated and the command says so.
    assert second.created_store_profile is False
    assert second.created_review_count == 0
    assert second.changed is False


async def test_the_command_entry_point_reports_both_outcomes(
    committed_seed_target: str,
    capsys: pytest.CaptureFixture[str],
) -> None:
    # Given: an operator running the module directly.
    assert committed_seed_target

    # When: the command runs on an empty and then on a seeded database.
    # main() owns its own event loop, so it runs off the test's loop.
    await asyncio.to_thread(main)
    first_output = capsys.readouterr().out
    await asyncio.to_thread(main)
    second_output = capsys.readouterr().out

    # Then: the operator can tell whether anything was written.
    assert "Seeded store profile: True" in first_output
    assert "nothing to do" in second_output
