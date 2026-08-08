from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from typing import ClassVar, Literal

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict

from mapkeeper.api.error_handlers import install_error_handlers
from mapkeeper.api.middleware import request_id_middleware
from mapkeeper.api.router import api_router
from mapkeeper.core.logging import configure_logging, get_logger
from mapkeeper.db.session import dispose_engine, get_session_factory
from mapkeeper.services.recovery import recover_interrupted_work

logger = get_logger(__name__)


class HealthResponse(BaseModel):
    """Health endpoint response."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    status: Literal["ok"] = "ok"


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncGenerator[None, None]:
    """Set up logging, close out interrupted work, and release connections on stop.

    Platform tasks run in BackgroundTasks and do not survive a restart, so anything
    left mid-flight is failed on start rather than left waiting forever. An
    unreachable database must not stop the service from answering /health.
    """
    configure_logging()
    try:
        _ = await recover_interrupted_work(get_session_factory())
    except Exception:
        logger.exception("could not recover interrupted platform tasks on startup")
        # Release anything the failed attempt left half-open.
        await dispose_engine()
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
_ = app.middleware("http")(request_id_middleware)
install_error_handlers(app)
app.include_router(api_router)


@app.get("/health", tags=["system"])
def get_health() -> HealthResponse:
    """Return the current service health."""
    return HealthResponse()
