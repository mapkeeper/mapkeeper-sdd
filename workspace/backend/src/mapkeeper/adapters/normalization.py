"""T222: reduce whatever a platform client raises to one of six contract codes.

Only timeout, rate limiting and platform server errors are retryable. Authentication,
permission and validation failures will fail again the same way, so they are not
retried. Nothing from the original failure is carried forward: a vendor response can
contain a token, a signature or customer data.
"""

from asyncio import TimeoutError as AsyncTimeoutError
from http import HTTPStatus
from typing import Final

from mapkeeper.adapters.base import PlatformError
from mapkeeper.models import Platform, PlatformErrorCode

TIMEOUT_EXCEPTIONS: Final[tuple[type[BaseException], ...]] = (AsyncTimeoutError, TimeoutError)

_STATUS_TO_CODE: Final[dict[int, PlatformErrorCode]] = {
    HTTPStatus.UNAUTHORIZED: PlatformErrorCode.AUTHENTICATION_ERROR,
    HTTPStatus.FORBIDDEN: PlatformErrorCode.PERMISSION_DENIED,
    HTTPStatus.TOO_MANY_REQUESTS: PlatformErrorCode.RATE_LIMITED,
}


def code_for_status(status_code: int) -> PlatformErrorCode:
    """Map an external HTTP status onto the contract's platform error codes."""
    mapped = _STATUS_TO_CODE.get(status_code)
    if mapped is not None:
        return mapped
    if status_code >= HTTPStatus.INTERNAL_SERVER_ERROR:
        return PlatformErrorCode.PLATFORM_SERVER_ERROR
    return PlatformErrorCode.PLATFORM_VALIDATION_ERROR


def normalize_status(platform: Platform, status_code: int) -> PlatformError:
    """Turn an external HTTP status into a normalized platform error."""
    return PlatformError(code=code_for_status(status_code), platform=platform)


def normalize_exception(platform: Platform, exc: BaseException) -> PlatformError:
    """Turn any client exception into a normalized platform error.

    An unrecognised failure is treated as a platform server error, which is
    retryable: an unknown transport problem is more likely transient than a
    rejection the platform would repeat.
    """
    if isinstance(exc, TIMEOUT_EXCEPTIONS):
        return PlatformError(code=PlatformErrorCode.API_TIMEOUT, platform=platform)
    return PlatformError(code=PlatformErrorCode.PLATFORM_SERVER_ERROR, platform=platform)
