from typing import Final

import pytest
from pydantic import ValidationError

from mapkeeper.api.schemas.sync import (
    PlatformTaskError,
    PlatformTaskStatus,
    SyncJobRetryResponse,
    SyncJobStatusResponse,
)
from mapkeeper.models.enums import (
    Platform,
    PlatformErrorCode,
    PlatformSyncTaskStatus,
    SyncJobStatus,
)

SYNC_JOB_ID: Final = "66666666-6666-4666-8666-666666666666"
STATUS_URL: Final = f"/api/v1/sync-jobs/{SYNC_JOB_ID}"


def _task(platform: str, task_status: str, attempts: int) -> dict[str, object]:
    return {"platform": platform, "status": task_status, "attemptCount": attempts, "error": None}


def test_a_partial_success_job_reports_each_platform_separately() -> None:
    # Given: the partial success example from the API Contract.
    payload = {
        "syncJobId": SYNC_JOB_ID,
        "status": "PARTIAL_SUCCESS",
        "platformTasks": [
            _task("google", "SUCCESS", 1),
            {
                "platform": "naver",
                "status": "FAILED",
                "attemptCount": 2,
                "error": {
                    "code": "API_TIMEOUT",
                    "message": "Naver 플랫폼 처리 시간이 초과되었습니다.",
                    "retryable": True,
                    "platform": "naver",
                },
            },
            _task("kakao", "SUCCESS", 1),
        ],
    }

    # When: the response is validated.
    response = SyncJobStatusResponse.model_validate(payload)

    # Then: the aggregate and the per-platform detail are both preserved.
    assert response.status is SyncJobStatus.PARTIAL_SUCCESS
    failed = next(
        task for task in response.platform_tasks if task.status is PlatformSyncTaskStatus.FAILED
    )
    assert failed.error is not None
    assert failed.error.code is PlatformErrorCode.API_TIMEOUT
    assert failed.error.retryable is True


@pytest.mark.parametrize(
    ("code", "retryable"),
    [
        ("API_TIMEOUT", False),
        ("RATE_LIMITED", False),
        ("PLATFORM_SERVER_ERROR", False),
        ("AUTHENTICATION_ERROR", True),
        ("PERMISSION_DENIED", True),
        ("PLATFORM_VALIDATION_ERROR", True),
    ],
)
def test_retryable_must_agree_with_the_error_code(code: str, retryable: bool) -> None:
    # Given: an error whose retryable flag contradicts its code.
    payload = {"code": code, "message": "boom", "retryable": retryable, "platform": "naver"}

    # When / Then: only timeout, rate limit and server errors may be retried.
    with pytest.raises(ValidationError):
        _ = PlatformTaskError.model_validate(payload)


def test_a_task_error_must_name_its_own_platform() -> None:
    # Given: a Naver task carrying a Google error.
    payload = {
        "platform": "naver",
        "status": "FAILED",
        "attemptCount": 1,
        "error": {
            "code": "API_TIMEOUT",
            "message": "timeout",
            "retryable": True,
            "platform": "google",
        },
    }

    # When / Then: the mismatch is refused before it reaches a status screen.
    with pytest.raises(ValidationError):
        _ = PlatformTaskStatus.model_validate(payload)


def test_attempt_count_cannot_exceed_three() -> None:
    # Given: a task claiming a fourth attempt.
    payload = _task("google", "FAILED", 4)

    # When / Then: the retry ceiling is enforced at the API edge too.
    with pytest.raises(ValidationError):
        _ = PlatformTaskStatus.model_validate(payload)


def test_a_status_response_must_cover_all_three_platforms() -> None:
    # Given: a job reporting Google twice and Kakao never.
    payload = {
        "syncJobId": SYNC_JOB_ID,
        "status": "PENDING",
        "platformTasks": [
            _task("google", "PENDING", 0),
            _task("google", "PENDING", 0),
            _task("naver", "PENDING", 0),
        ],
    }

    # When / Then: every platform appears exactly once.
    with pytest.raises(ValidationError):
        _ = SyncJobStatusResponse.model_validate(payload)


def test_a_retry_response_lists_the_platforms_being_retried() -> None:
    # Given: the retry example from the API Contract.
    payload = {
        "syncJobId": SYNC_JOB_ID,
        "status": "RETRYING",
        "retryingPlatforms": ["naver"],
        "statusUrl": STATUS_URL,
    }

    # When: the response is validated.
    response = SyncJobRetryResponse.model_validate(payload)

    # Then: the client learns which platforms run again and where to poll.
    assert response.retrying_platforms == (Platform.NAVER,)
    assert response.status_url == STATUS_URL


@pytest.mark.parametrize("platforms", [[], ["naver", "naver"]])
def test_a_retry_response_rejects_an_empty_or_repeated_platform_list(
    platforms: list[str],
) -> None:
    # Given: a retry naming no platform, or the same one twice.
    payload = {
        "syncJobId": SYNC_JOB_ID,
        "status": "RETRYING",
        "retryingPlatforms": platforms,
        "statusUrl": STATUS_URL,
    }

    # When / Then: a retry always names a distinct, non-empty set of platforms.
    with pytest.raises(ValidationError):
        _ = SyncJobRetryResponse.model_validate(payload)


def test_partial_success_is_not_a_platform_task_status() -> None:
    # Given: a task claiming the aggregate-only status.
    payload = _task("google", "PARTIAL_SUCCESS", 1)

    # When / Then: PARTIAL_SUCCESS never describes one platform.
    with pytest.raises(ValidationError):
        _ = PlatformTaskStatus.model_validate(payload)
