"""T222: the boundary every external platform is reached through.

An adapter either succeeds or raises PlatformSyncFailure carrying an already
normalized error, so the retry service never has to know which platform failed or
which client library raised. Nothing outside this package sees a vendor exception.
"""

from dataclasses import dataclass
from typing import Final, Protocol
from uuid import UUID

from mapkeeper.models import Platform, PlatformErrorCode
from mapkeeper.models.enums import RETRYABLE_PLATFORM_ERROR_CODES

SAFE_MESSAGES: Final[dict[PlatformErrorCode, str]] = {
    PlatformErrorCode.API_TIMEOUT: "플랫폼 처리 시간이 초과되었습니다.",
    PlatformErrorCode.RATE_LIMITED: "플랫폼 요청 제한에 걸렸습니다.",
    PlatformErrorCode.PLATFORM_SERVER_ERROR: "플랫폼 서버에 일시적인 문제가 있습니다.",
    PlatformErrorCode.AUTHENTICATION_ERROR: "플랫폼 인증이 만료되었습니다.",
    PlatformErrorCode.PERMISSION_DENIED: "플랫폼 접근 권한이 없습니다.",
    PlatformErrorCode.PLATFORM_VALIDATION_ERROR: "플랫폼이 요청 값을 거절했습니다.",
}


@dataclass(frozen=True)
class PlatformError:
    """One platform failure, already reduced to what a client may safely see.

    Nothing vendor-specific survives here: no raw response body, token or signature.
    """

    code: PlatformErrorCode
    platform: Platform

    @property
    def retryable(self) -> bool:
        """Return whether another attempt could succeed."""
        return self.code in RETRYABLE_PLATFORM_ERROR_CODES

    @property
    def message(self) -> str:
        """Return the fixed, safe message for this error code."""
        return SAFE_MESSAGES[self.code]


class PlatformSyncError(Exception):
    """Raised by an adapter when a platform did not accept the update."""

    def __init__(self, error: PlatformError) -> None:
        """Carry the normalized error the retry service will act on."""
        super().__init__(f"{error.platform.value}: {error.code.value}")
        self.error: PlatformError = error


@dataclass(frozen=True)
class SyncRequest:
    """What one platform is asked to publish."""

    sync_job_id: UUID
    store_profile_id: UUID
    platform: Platform


class PlatformAdapter(Protocol):
    """Publishes one approved change set to one external platform."""

    @property
    def platform(self) -> Platform:
        """Return the platform this adapter speaks to."""
        ...

    async def publish(self, request: SyncRequest) -> None:
        """Apply the approved state on the platform.

        Raises:
            PlatformSyncFailure: the platform refused or could not be reached.
        """
        ...
