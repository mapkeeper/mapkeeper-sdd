"""Turn every failure into the contract's response envelope.

Two rules drive this module. Clients always see the same envelope shape, and no
submitted value, internal message or stack detail ever reaches the response body.
"""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Final, cast

from fastapi import FastAPI, Request, Response, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from mapkeeper.api.middleware import scoped_request_id
from mapkeeper.api.schemas.common import ApiError, ErrorEnvelope, ValidationDetail
from mapkeeper.core.errors import SAFE_INTERNAL_MESSAGE, MapKeeperError
from mapkeeper.core.logging import (
    REQUEST_ID_HEADER,
    get_logger,
    get_request_id,
    reset_request_id,
    safe_traceback,
    set_request_id,
)
from mapkeeper.models.enums import ApiErrorCode, ApiResponseStatus

logger = get_logger(__name__)

MALFORMED_REQUEST_MESSAGE: Final = "요청 형식을 해석할 수 없습니다."
VALIDATION_MESSAGE: Final = "입력값을 확인해 주세요."
NOT_FOUND_MESSAGE: Final = "요청한 리소스를 찾을 수 없습니다."
RATE_LIMITED_MESSAGE: Final = "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."

_STATUS_TO_CODE: Final[dict[int, ApiErrorCode]] = {
    status.HTTP_400_BAD_REQUEST: ApiErrorCode.MALFORMED_REQUEST,
    status.HTTP_404_NOT_FOUND: ApiErrorCode.RESOURCE_NOT_FOUND,
    status.HTTP_409_CONFLICT: ApiErrorCode.INVALID_STATE,
    status.HTTP_422_UNPROCESSABLE_CONTENT: ApiErrorCode.VALIDATION_ERROR,
    status.HTTP_429_TOO_MANY_REQUESTS: ApiErrorCode.REQUEST_RATE_LIMITED,
}
_STATUS_TO_MESSAGE: Final[dict[int, str]] = {
    status.HTTP_400_BAD_REQUEST: MALFORMED_REQUEST_MESSAGE,
    status.HTTP_404_NOT_FOUND: NOT_FOUND_MESSAGE,
    status.HTTP_422_UNPROCESSABLE_CONTENT: VALIDATION_MESSAGE,
    status.HTTP_429_TOO_MANY_REQUESTS: RATE_LIMITED_MESSAGE,
}


def resolve_request_id(request: Request | None = None) -> str:
    """Return the trace id for this failure.

    The context variable is released once user middleware unwinds, so an unhandled
    exception - which Starlette reports from outside it - falls back to the id kept
    on the ASGI scope.
    """
    if request is not None:
        scoped = scoped_request_id(request)
        if scoped is not None:
            return scoped
    return get_request_id()


def build_error_response(
    http_status: int,
    error: ApiError,
    request: Request | None = None,
) -> JSONResponse:
    """Render one failure as the contract's envelope, stamped with the trace id."""
    envelope = ErrorEnvelope(
        success=False,
        status=ApiResponseStatus.FAILED,
        data=None,
        error=error,
        timestamp=datetime.now(UTC),
    )
    return JSONResponse(
        status_code=http_status,
        content=envelope.model_dump(by_alias=True, mode="json"),
        headers={REQUEST_ID_HEADER: resolve_request_id(request)},
    )


def describe_location(location: object) -> str:
    """Render a pydantic error location as a dotted field path."""
    if isinstance(location, Sequence) and not isinstance(location, str | bytes):
        return ".".join(str(part) for part in location) or "body"
    return str(location)


def validation_details(exc: RequestValidationError) -> tuple[ValidationDetail, ...]:
    """Name the failing fields without echoing what the client submitted.

    Pydantic reports the offending input alongside each error; that input may be
    customer PII, so only the location and the reason are passed on.
    """
    reported = cast("list[dict[str, object]]", exc.errors())
    return tuple(
        ValidationDetail(
            field=describe_location(error.get("loc", ())),
            reason=str(error.get("msg", "")),
        )
        for error in reported
    )


async def handle_mapkeeper_error(request: Request, exc: Exception) -> Response:
    """Answer a known domain failure with its contract code."""
    if not isinstance(exc, MapKeeperError):  # pragma: no cover - defensive
        raise exc
    logger.warning("%s %s -> %s", request.method, request.url.path, exc.code.value)
    error = ApiError(code=exc.code, message=exc.message, retryable=exc.retryable)
    return build_error_response(exc.http_status, error, request)


async def handle_validation_error(request: Request, exc: Exception) -> Response:
    """Answer a schema violation with 422 and safe field-level detail."""
    if not isinstance(exc, RequestValidationError):  # pragma: no cover - defensive
        raise exc
    details = validation_details(exc)
    logger.info(
        "%s %s -> VALIDATION_ERROR on %s",
        request.method,
        request.url.path,
        [detail.field for detail in details],
    )
    error = ApiError(
        code=ApiErrorCode.VALIDATION_ERROR,
        message=VALIDATION_MESSAGE,
        details=details,
    )
    return build_error_response(status.HTTP_422_UNPROCESSABLE_CONTENT, error, request)


async def handle_http_exception(request: Request, exc: Exception) -> Response:
    """Answer a framework-raised HTTP error in the same envelope."""
    if not isinstance(exc, StarletteHTTPException):  # pragma: no cover - defensive
        raise exc
    code = _STATUS_TO_CODE.get(exc.status_code, ApiErrorCode.INTERNAL_SERVER_ERROR)
    message = _STATUS_TO_MESSAGE.get(exc.status_code, SAFE_INTERNAL_MESSAGE)
    logger.info("%s %s -> %s", request.method, request.url.path, exc.status_code)
    return build_error_response(exc.status_code, ApiError(code=code, message=message), request)


async def handle_unexpected_error(request: Request, exc: Exception) -> Response:
    """Log the real cause and answer with a message that reveals nothing.

    Starlette reports an unhandled exception from outside user middleware, so the
    trace id is re-bound here to keep the log line and the response on the same id.
    """
    token = set_request_id(resolve_request_id(request))
    try:
        return _report_unexpected(request, exc)
    finally:
        reset_request_id(token)


def _report_unexpected(request: Request, exc: Exception) -> Response:
    logger.error(
        "%s %s failed unexpectedly exceptionType=%s at=%s",
        request.method,
        request.url.path,
        type(exc).__name__,
        safe_traceback(exc),
    )
    error = ApiError(
        code=ApiErrorCode.INTERNAL_SERVER_ERROR,
        message=SAFE_INTERNAL_MESSAGE,
    )
    return build_error_response(status.HTTP_500_INTERNAL_SERVER_ERROR, error, request)


def install_error_handlers(app: FastAPI) -> None:
    """Register every handler that keeps responses inside the contract."""
    app.add_exception_handler(MapKeeperError, handle_mapkeeper_error)
    app.add_exception_handler(RequestValidationError, handle_validation_error)
    app.add_exception_handler(StarletteHTTPException, handle_http_exception)
    app.add_exception_handler(Exception, handle_unexpected_error)
