"""Every failure leaves the API in the envelope the contract publishes."""

from collections.abc import Iterator
from typing import Final

import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient

from mapkeeper.api.error_handlers import build_error_response, install_error_handlers
from mapkeeper.core.errors import (
    SAFE_INTERNAL_MESSAGE,
    IdempotencyConflictError,
    InvalidStateError,
    MapKeeperError,
    NoRetryableTasksError,
    NotImplementedYetError,
    ResourceNotFoundError,
    StaleProposalError,
)
from mapkeeper.main import app
from mapkeeper.models.enums import ApiErrorCode

from .jsonassert import body_of, obj, text_of

SYNC_JOB_ID: Final = "66666666-6666-4666-8666-666666666666"


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """Return a client for the assembled application."""
    with TestClient(app) as test_client:
        yield test_client


def test_a_validation_failure_uses_the_response_envelope(client: TestClient) -> None:
    # Given: a request with an invalid path id.

    # When: the API rejects it.
    response = client.get("/api/v1/sync-jobs/not-a-uuid")
    body = body_of(response.text)

    # Then: the client parses failures exactly as the contract documents.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert body["success"] is False
    assert body["status"] == "FAILED"
    assert body["data"] is None
    assert text_of(obj(body["error"])["code"]) == ApiErrorCode.VALIDATION_ERROR.value
    assert body["timestamp"]


def test_an_unknown_path_uses_the_response_envelope(client: TestClient) -> None:
    # Given: a path outside the contract.

    # When: it is requested.
    response = client.get("/api/v1/does-not-exist")
    body = body_of(response.text)

    # Then: even routing failures keep the documented shape.
    assert response.status_code == status.HTTP_404_NOT_FOUND
    assert text_of(obj(body["error"])["code"]) == ApiErrorCode.RESOURCE_NOT_FOUND.value
    assert body["data"] is None


def test_a_malformed_json_body_is_reported_as_a_validation_error(client: TestClient) -> None:
    # Given: a body that is not valid JSON.

    # When: it is posted.
    response = client.post(
        "/api/v1/store-change-proposals",
        content=b"{not json",
        headers={"Content-Type": "application/json"},
    )

    # Then: the caller gets the envelope rather than a framework error page.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    error = obj(body_of(response.text)["error"])
    assert text_of(error["code"]) == ApiErrorCode.VALIDATION_ERROR.value


def test_an_unimplemented_route_still_answers_in_the_envelope(client: TestClient) -> None:
    # Given: a route declared for the contract but not yet built.

    # When: it is called.
    response = client.get(f"/api/v1/sync-jobs/{SYNC_JOB_ID}")

    # Then: the transitional 501 is honest and still machine-readable.
    assert response.status_code == status.HTTP_501_NOT_IMPLEMENTED
    assert body_of(response.text)["success"] is False


@pytest.mark.parametrize(
    ("error", "expected_status", "expected_code"),
    [
        (ResourceNotFoundError("없음"), 404, ApiErrorCode.RESOURCE_NOT_FOUND),
        (InvalidStateError("전이 불가"), 409, ApiErrorCode.INVALID_STATE),
        (StaleProposalError("값이 다름"), 409, ApiErrorCode.STALE_PROPOSAL),
        (IdempotencyConflictError("키 충돌"), 409, ApiErrorCode.IDEMPOTENCY_CONFLICT),
        (NoRetryableTasksError("재시도 없음"), 409, ApiErrorCode.NO_RETRYABLE_TASKS),
    ],
)
def test_each_domain_error_carries_its_contract_status_and_code(
    error: MapKeeperError,
    expected_status: int,
    expected_code: ApiErrorCode,
) -> None:
    # Given: one failure the API Contract's error table defines.

    # When / Then: it already knows how it must be reported.
    assert error.http_status == expected_status
    assert error.code is expected_code
    assert str(error)


def test_the_internal_error_message_reveals_nothing() -> None:
    # Given: the message used for unexpected failures.

    # When / Then: it names no table, path, driver or stack detail.
    lowered = SAFE_INTERNAL_MESSAGE.lower()
    for leak in ("sql", "traceback", "postgres", "asyncpg", "exception", "/"):
        assert leak not in lowered


def test_the_not_implemented_error_is_marked_as_transitional() -> None:
    # Given: the placeholder failure.
    error = NotImplementedYetError()

    # When / Then: it reports 501, which is not part of the published contract.
    assert error.http_status == status.HTTP_501_NOT_IMPLEMENTED
    assert error.code is ApiErrorCode.INTERNAL_SERVER_ERROR


def test_an_unexpected_failure_is_replaced_with_a_safe_message() -> None:
    # Given: an application that raises something unforeseen inside a route.
    broken = FastAPI()
    install_error_handlers(broken)

    async def boom() -> None:
        message = "connection to postgres://user:hunter2@db failed"
        raise RuntimeError(message)

    _ = broken.get("/boom")(boom)

    # When: the route is called.
    with TestClient(broken, raise_server_exceptions=False) as broken_client:
        response = broken_client.get("/boom")

    # Then: the caller sees a safe message, never the credential in the cause.
    assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
    assert "hunter2" not in response.text
    error = obj(body_of(response.text)["error"])
    assert text_of(error["message"]) == SAFE_INTERNAL_MESSAGE


def test_a_retryable_flag_can_be_reported_on_an_error() -> None:
    # Given: a failure the caller may safely retry.
    response = build_error_response(
        status.HTTP_429_TOO_MANY_REQUESTS,
        ApiErrorCode.REQUEST_RATE_LIMITED,
        "잠시 후 다시 시도해 주세요.",
        retryable=True,
    )

    # When / Then: the envelope carries the hint the client needs.
    assert response.status_code == status.HTTP_429_TOO_MANY_REQUESTS
    assert b'"retryable":true' in response.body


def test_a_non_sequence_error_location_is_still_reported() -> None:
    # Given: a validation error whose location is a bare value rather than a path.
    from mapkeeper.api.error_handlers import describe_location  # noqa: PLC0415

    # When / Then: the field name still reaches the client instead of crashing.
    assert describe_location("body") == "body"
    assert describe_location(()) == "body"
    assert describe_location(("body", "recognizedText")) == "body.recognizedText"
