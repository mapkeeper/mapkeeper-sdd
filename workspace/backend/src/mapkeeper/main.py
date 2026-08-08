from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import ClassVar, Literal

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict

from mapkeeper.api.router import api_router
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
    version="0.2.0",
    description=(
        "MapKeeper MVP v0.2. JSON fields are camelCase, ids are UUID strings and "
        "timestamps are UTC ISO 8601. Undefined request and response fields are rejected."
    ),
    lifespan=lifespan,
)
app.include_router(api_router)


@app.get("/health", tags=["system"])
def get_health() -> HealthResponse:
    """Return the current service health."""
    return HealthResponse()
