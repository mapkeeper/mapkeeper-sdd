from functools import lru_cache
from typing import ClassVar, Final

from pydantic import PostgresDsn, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

ASYNC_POSTGRES_SCHEME: Final = "postgresql+asyncpg"
UNSUPPORTED_DATABASE_SCHEME_MESSAGE: Final = (
    f"DATABASE_URL must use the {ASYNC_POSTGRES_SCHEME} driver"
)


class Settings(BaseSettings):
    """Runtime configuration read from the process environment."""

    model_config: ClassVar[SettingsConfigDict] = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
        frozen=True,
    )

    database_url: PostgresDsn
    db_echo: bool = False

    @field_validator("database_url")
    @classmethod
    def _require_async_driver(cls, value: PostgresDsn) -> PostgresDsn:
        if value.scheme != ASYNC_POSTGRES_SCHEME:
            raise ValueError(UNSUPPORTED_DATABASE_SCHEME_MESSAGE)
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the process-wide settings, reading the environment only once."""
    return Settings()  # pyright: ignore[reportCallIssue]
