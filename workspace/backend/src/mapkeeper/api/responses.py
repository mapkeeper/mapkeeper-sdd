"""Shared OpenAPI wiring: path parameters, contract headers and documented errors."""

from typing import Annotated, Final

from fastapi import Header, status

from mapkeeper.api.schemas.common import ErrorEnvelope, IdempotencyKey
from mapkeeper.models.enums import ApiErrorCode

IdempotencyKeyHeader = Annotated[
    IdempotencyKey,
    Header(
        alias="Idempotency-Key",
        description=(
            "Required on every approval. Same actor and key with the same approval target "
            "replays the existing SyncJob; a different target is 409 IDEMPOTENCY_CONFLICT."
        ),
    ),
]
RequestIdHeader = Annotated[
    str | None,
    Header(
        alias="X-Request-ID",
        description="Optional client trace id. The server generates one when it is absent.",
    ),
]


async def carry_request_id(x_request_id: RequestIdHeader = None) -> str | None:
    """Publish the optional trace header on every route and hand it to request logging."""
    return x_request_id


_DESCRIPTIONS: Final[dict[int, tuple[str, tuple[ApiErrorCode, ...]]]] = {
    status.HTTP_400_BAD_REQUEST: (
        "Unparseable JSON or an unusable request combination.",
        (ApiErrorCode.MALFORMED_REQUEST,),
    ),
    status.HTTP_404_NOT_FOUND: (
        "No resource matches the requested id.",
        (ApiErrorCode.RESOURCE_NOT_FOUND,),
    ),
    status.HTTP_409_CONFLICT: (
        "The requested transition cannot be performed in the current state.",
        (
            ApiErrorCode.INVALID_STATE,
            ApiErrorCode.STALE_PROPOSAL,
            ApiErrorCode.IDEMPOTENCY_CONFLICT,
            ApiErrorCode.NO_RETRYABLE_TASKS,
        ),
    ),
    status.HTTP_422_UNPROCESSABLE_CONTENT: (
        "Header, path or body field validation failed.",
        (ApiErrorCode.VALIDATION_ERROR,),
    ),
    status.HTTP_429_TOO_MANY_REQUESTS: (
        "MapKeeper API request limit reached.",
        (ApiErrorCode.REQUEST_RATE_LIMITED,),
    ),
    status.HTTP_500_INTERNAL_SERVER_ERROR: (
        "Internal error replaced with a safe message.",
        (ApiErrorCode.INTERNAL_SERVER_ERROR,),
    ),
}


def error_responses(*codes: int) -> dict[int | str, dict[str, object]]:
    """Document the failure envelope and its allowed error codes for each status code."""
    documented: dict[int | str, dict[str, object]] = {}
    for code in codes:
        summary, error_codes = _DESCRIPTIONS[code]
        joined = ", ".join(error_code.value for error_code in error_codes)
        documented[code] = {
            "model": ErrorEnvelope,
            "description": f"{summary} error.code is one of: {joined}.",
        }
    return documented


COMMON_ERRORS: Final = (
    status.HTTP_400_BAD_REQUEST,
    status.HTTP_422_UNPROCESSABLE_CONTENT,
    status.HTTP_429_TOO_MANY_REQUESTS,
    status.HTTP_500_INTERNAL_SERVER_ERROR,
)
RESOURCE_ERRORS: Final = (status.HTTP_404_NOT_FOUND, *COMMON_ERRORS)
TRANSITION_ERRORS: Final = (
    status.HTTP_404_NOT_FOUND,
    status.HTTP_409_CONFLICT,
    *COMMON_ERRORS,
)
