from typing import Annotated, Final, Self
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from mapkeeper.api.schemas.common import ApiSchema
from mapkeeper.models.enums import (
    RETRYABLE_PLATFORM_ERROR_CODES,
    Platform,
    PlatformErrorCode,
    PlatformSyncTaskStatus,
    SyncJobStatus,
)

MAX_ATTEMPT_COUNT: Final = 3
SUPPORTED_PLATFORM_COUNT: Final = 3
REQUIRED_PLATFORMS: Final = frozenset({Platform.GOOGLE, Platform.NAVER, Platform.KAKAO})

NonEmptyText = Annotated[str, StringConstraints(min_length=1, strip_whitespace=True)]
AttemptCount = Annotated[int, Field(ge=0, le=MAX_ATTEMPT_COUNT)]

INCONSISTENT_RETRYABLE: Final = "inconsistent_retryable"
INCONSISTENT_RETRYABLE_MESSAGE: Final = (
    "retryable must be true only for timeout, rate limit and platform server errors"
)
MISMATCHED_ERROR_PLATFORM: Final = "mismatched_error_platform"
MISMATCHED_ERROR_PLATFORM_MESSAGE: Final = "error.platform must match the task platform"
INVALID_PLATFORM_COVERAGE: Final = "invalid_platform_coverage"
INVALID_PLATFORM_COVERAGE_MESSAGE: Final = (
    "platformTasks must contain exactly one task for each supported platform"
)
EMPTY_RETRYING_PLATFORMS: Final = "empty_retrying_platforms"
EMPTY_RETRYING_PLATFORMS_MESSAGE: Final = "retryingPlatforms must not repeat or be empty"


class PlatformTaskError(ApiSchema):
    """Normalized failure reported by one external platform."""

    code: PlatformErrorCode
    message: str
    retryable: bool
    platform: Platform

    @model_validator(mode="after")
    def _validate_retryable(self) -> Self:
        if self.retryable != (self.code in RETRYABLE_PLATFORM_ERROR_CODES):
            raise PydanticCustomError(
                INCONSISTENT_RETRYABLE,
                INCONSISTENT_RETRYABLE_MESSAGE,
            )
        return self


class PlatformTaskStatus(ApiSchema):
    """Execution state of exactly one platform within a synchronization job."""

    platform: Platform
    status: PlatformSyncTaskStatus
    attempt_count: AttemptCount
    error: PlatformTaskError | None = None

    @model_validator(mode="after")
    def _validate_error_platform(self) -> Self:
        if self.error is not None and self.error.platform != self.platform:
            raise PydanticCustomError(
                MISMATCHED_ERROR_PLATFORM,
                MISMATCHED_ERROR_PLATFORM_MESSAGE,
            )
        return self


class SyncJobStatusResponse(ApiSchema):
    """Aggregate job status with per-platform detail."""

    sync_job_id: UUID
    status: SyncJobStatus
    platform_tasks: Annotated[
        tuple[PlatformTaskStatus, ...],
        Field(min_length=SUPPORTED_PLATFORM_COUNT, max_length=SUPPORTED_PLATFORM_COUNT),
    ]

    @model_validator(mode="after")
    def _validate_platform_coverage(self) -> Self:
        platforms = frozenset(task.platform for task in self.platform_tasks)
        if platforms != REQUIRED_PLATFORMS:
            raise PydanticCustomError(
                INVALID_PLATFORM_COVERAGE,
                INVALID_PLATFORM_COVERAGE_MESSAGE,
            )
        return self


class SyncJobRetryResponse(ApiSchema):
    """Platforms accepted for another attempt after a retryable failure."""

    sync_job_id: UUID
    status: SyncJobStatus
    retrying_platforms: Annotated[
        tuple[Platform, ...],
        Field(min_length=1, max_length=SUPPORTED_PLATFORM_COUNT),
    ]
    status_url: NonEmptyText

    @model_validator(mode="after")
    def _validate_retrying_platforms(self) -> Self:
        platforms = self.retrying_platforms
        if len(set(platforms)) != len(platforms):
            raise PydanticCustomError(
                EMPTY_RETRYING_PLATFORMS,
                EMPTY_RETRYING_PLATFORMS_MESSAGE,
            )
        return self
