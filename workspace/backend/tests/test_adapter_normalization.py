"""T222: whatever a platform client raises becomes one of six contract codes."""

from http import HTTPStatus

import pytest

from mapkeeper.adapters.base import PlatformError, PlatformSyncError
from mapkeeper.adapters.normalization import normalize_exception, normalize_status
from mapkeeper.models import Platform, PlatformErrorCode


@pytest.mark.parametrize(
    ("status_code", "expected"),
    [
        (HTTPStatus.UNAUTHORIZED, PlatformErrorCode.AUTHENTICATION_ERROR),
        (HTTPStatus.FORBIDDEN, PlatformErrorCode.PERMISSION_DENIED),
        (HTTPStatus.TOO_MANY_REQUESTS, PlatformErrorCode.RATE_LIMITED),
        (HTTPStatus.BAD_REQUEST, PlatformErrorCode.PLATFORM_VALIDATION_ERROR),
        (HTTPStatus.NOT_FOUND, PlatformErrorCode.PLATFORM_VALIDATION_ERROR),
        (HTTPStatus.INTERNAL_SERVER_ERROR, PlatformErrorCode.PLATFORM_SERVER_ERROR),
        (HTTPStatus.BAD_GATEWAY, PlatformErrorCode.PLATFORM_SERVER_ERROR),
        (HTTPStatus.SERVICE_UNAVAILABLE, PlatformErrorCode.PLATFORM_SERVER_ERROR),
    ],
)
def test_each_external_status_maps_to_a_contract_code(
    status_code: int,
    expected: PlatformErrorCode,
) -> None:
    # Given: a status an external platform returned.

    # When: it is normalized.
    error = normalize_status(Platform.NAVER, status_code)

    # Then: the retry service sees a code from the contract, not an HTTP number.
    assert error.code is expected
    assert error.platform is Platform.NAVER


@pytest.mark.parametrize(
    ("code", "retryable"),
    [
        (PlatformErrorCode.API_TIMEOUT, True),
        (PlatformErrorCode.RATE_LIMITED, True),
        (PlatformErrorCode.PLATFORM_SERVER_ERROR, True),
        (PlatformErrorCode.AUTHENTICATION_ERROR, False),
        (PlatformErrorCode.PERMISSION_DENIED, False),
        (PlatformErrorCode.PLATFORM_VALIDATION_ERROR, False),
    ],
)
def test_only_transient_failures_are_retryable(
    code: PlatformErrorCode,
    retryable: bool,
) -> None:
    # Given: one normalized platform error.
    error = PlatformError(code=code, platform=Platform.GOOGLE)

    # When / Then: retrying an authentication or validation failure would fail again.
    assert error.retryable is retryable


def test_a_timeout_is_recognised() -> None:
    # Given: a client that gave up waiting.

    # When / Then: a timeout is retryable, as the contract requires.
    error = normalize_exception(Platform.KAKAO, TimeoutError())
    assert error.code is PlatformErrorCode.API_TIMEOUT
    assert error.retryable is True


def test_an_unrecognised_failure_is_treated_as_transient() -> None:
    # Given: a transport failure nobody anticipated.
    error = normalize_exception(Platform.GOOGLE, OSError("connection reset"))

    # When / Then: an unknown transport problem is more likely transient than final.
    assert error.code is PlatformErrorCode.PLATFORM_SERVER_ERROR
    assert error.retryable is True


def test_every_error_code_has_a_safe_message() -> None:
    # Given: each error a client may be shown.

    # When / Then: the message is fixed and reveals nothing about the platform call.
    for code in PlatformErrorCode:
        message = PlatformError(code=code, platform=Platform.NAVER).message
        assert message
        assert "http" not in message.lower()
        assert "token" not in message.lower()


def test_a_failure_carries_the_normalized_error_without_leaking_detail() -> None:
    # Given: an adapter reporting a rejected update.
    error = PlatformError(code=PlatformErrorCode.PERMISSION_DENIED, platform=Platform.KAKAO)

    # When: it is raised to the runner.
    failure = PlatformSyncError(error)

    # Then: only the platform and the code travel with it.
    assert failure.error is error
    assert str(failure) == "kakao: PERMISSION_DENIED"
