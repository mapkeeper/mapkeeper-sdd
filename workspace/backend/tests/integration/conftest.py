from collections.abc import AsyncGenerator
from typing import ClassVar, Final

import pytest
import pytest_asyncio
from pydantic import PostgresDsn
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

SKIP_REASON: Final = "TEST_DATABASE_URL is not set; live PostgreSQL checks are skipped"


class IntegrationSettings(BaseSettings):
    """Location of the disposable database these checks migrate and write to."""

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    test_database_url: PostgresDsn | None = None


@pytest.fixture
def integration_database_url() -> str:
    """Return the test DSN, skipping the check when no database is configured."""
    url = IntegrationSettings().test_database_url
    if url is None:
        pytest.skip(SKIP_REASON)
    return str(url)


@pytest_asyncio.fixture
async def db_session(integration_database_url: str) -> AsyncGenerator[AsyncSession, None]:
    """Yield a session whose work is always rolled back, leaving the database untouched."""
    engine = create_async_engine(integration_database_url, poolclass=NullPool)
    try:
        async with engine.connect() as connection:
            transaction = await connection.begin()
            session = AsyncSession(bind=connection, expire_on_commit=False)
            try:
                yield session
            finally:
                await session.close()
                # A constraint violation already aborted and detached the transaction.
                if transaction.is_active:
                    await transaction.rollback()
    finally:
        await engine.dispose()
