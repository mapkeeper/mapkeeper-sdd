from typing import ClassVar, Literal

from fastapi import FastAPI
from pydantic import BaseModel, ConfigDict


class HealthResponse(BaseModel):
    """Health endpoint response."""

    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)

    status: Literal["ok"] = "ok"


app = FastAPI(
    title="MapKeeper API",
    version="0.1.0",
)


@app.get("/health", tags=["system"])
def get_health() -> HealthResponse:
    """Return the current service health."""
    return HealthResponse()
