"""Domain errors that map onto the API Contract's error table.

Messages are written for the caller and never carry PII, secrets, an Idempotency-Key
or an external platform's raw response.
"""

from typing import Final

from fastapi import status

from mapkeeper.models.enums import ApiErrorCode

SAFE_INTERNAL_MESSAGE: Final = "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요."
NOT_IMPLEMENTED_MESSAGE: Final = (
    "이 기능은 아직 제공되지 않습니다. v0.2 계약에만 정의된 엔드포인트입니다."
)


class MapKeeperError(Exception):
    """Base failure that already knows its HTTP status and contract error code."""

    http_status: int = status.HTTP_500_INTERNAL_SERVER_ERROR
    code: ApiErrorCode = ApiErrorCode.INTERNAL_SERVER_ERROR

    def __init__(self, message: str, *, retryable: bool | None = None) -> None:
        """Store a caller-safe message and an optional retry hint."""
        super().__init__(message)
        self.message: str = message
        self.retryable: bool | None = retryable


class ResourceNotFoundError(MapKeeperError):
    """No resource matches the requested id."""

    http_status: int = status.HTTP_404_NOT_FOUND
    code: ApiErrorCode = ApiErrorCode.RESOURCE_NOT_FOUND


class InvalidStateError(MapKeeperError):
    """The requested transition cannot be performed from the current state."""

    http_status: int = status.HTTP_409_CONFLICT
    code: ApiErrorCode = ApiErrorCode.INVALID_STATE


class StaleProposalError(MapKeeperError):
    """A patch carried a currentValue that no longer matches the stored proposal."""

    http_status: int = status.HTTP_409_CONFLICT
    code: ApiErrorCode = ApiErrorCode.STALE_PROPOSAL


class IdempotencyConflictError(MapKeeperError):
    """The same actor reused an Idempotency-Key for a different approval."""

    http_status: int = status.HTTP_409_CONFLICT
    code: ApiErrorCode = ApiErrorCode.IDEMPOTENCY_CONFLICT


class NoRetryableTasksError(MapKeeperError):
    """The job has no failed platform that may be retried."""

    http_status: int = status.HTTP_409_CONFLICT
    code: ApiErrorCode = ApiErrorCode.NO_RETRYABLE_TASKS


class NotImplementedYetError(MapKeeperError):
    """The endpoint is published for the contract but its behaviour is not built.

    Transitional: it disappears as T225 and T227~T234 land.
    """

    http_status: int = status.HTTP_501_NOT_IMPLEMENTED

    def __init__(self) -> None:
        """Report the fixed placeholder message."""
        super().__init__(NOT_IMPLEMENTED_MESSAGE)
