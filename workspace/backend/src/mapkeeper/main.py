from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import ClassVar, Literal

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict

from mapkeeper.db.session import dispose_engine


class HealthResponse(BaseModel):
    """Health endpoint response."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    status: Literal["ok"] = "ok"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Release pooled database connections when the service stops."""
    yield
    await dispose_engine()


app = FastAPI(
    title="MapKeeper API",
    version="0.1.0",
    lifespan=lifespan,
)


@app.get("/health", tags=["system"])
def get_health() -> HealthResponse:
    """Return the current service health."""
    return HealthResponse()
