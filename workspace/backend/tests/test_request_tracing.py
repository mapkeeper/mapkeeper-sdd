"""T218: every request is traceable and no sensitive value reaches a log or a response."""

import logging
from collections.abc import Iterator
from typing import Final
from uuid import UUID, uuid4

import pytest
from fastapi import status
from fastapi.testclient import TestClient

from mapkeeper.core.logging import (
    REQUEST_ID_HEADER,
    UNSET_REQUEST_ID,
    configure_logging,
    fingerprint,
    get_logger,
    get_request_id,
    job_context,
    new_request_id,
    reset_request_id,
    sanitize_request_id,
    set_request_id,
    stamp_request_id,
)
from mapkeeper.main import app

SYNC_JOB_ID: Final = "66666666-6666-4666-8666-666666666666"
STATUS_PATH: Final = f"/api/v1/sync-jobs/{SYNC_JOB_ID}"


@pytest.fixture(scope="module")
def client() -> Iterator[TestClient]:
    """Return a client for the assembled application."""
    with TestClient(app) as test_client:
        yield test_client


def test_the_server_generates_a_trace_id_when_the_client_sends_none(
    client: TestClient,
) -> None:
    # Given: a client that does not trace its own requests.

    # When: it calls the API.
    response = client.get(STATUS_PATH)

    # Then: the server hands back the id it will have logged against.
    assert response.headers[REQUEST_ID_HEADER]


def test_a_client_trace_id_is_returned_unchanged(client: TestClient) -> None:
    # Given: a client supplying its own id.
    supplied = "trace-abc.123:xyz"

    # When: it calls the API.
    response = client.get(STATUS_PATH, headers={REQUEST_ID_HEADER: supplied})

    # Then: both sides can correlate on the same value.
    assert response.headers[REQUEST_ID_HEADER] == supplied


@pytest.mark.parametrize(
    "hostile",
    [
        "a" * 129,
        "trace id with spaces",
        "<script>alert(1)</script>",
        "trace\r\nSet-Cookie: x=1",
        "   ",
    ],
)
def test_an_unsafe_client_trace_id_is_replaced_rather_than_echoed(
    client: TestClient,
    hostile: str,
) -> None:
    # Given: a trace id that is too long, malformed or trying to inject a header.

    # When: it is sent to the API.
    response = client.get(STATUS_PATH, headers={REQUEST_ID_HEADER: hostile})

    # Then: the server answers with a generated id instead of reflecting the input.
    returned = response.headers[REQUEST_ID_HEADER]
    assert returned != hostile
    assert returned.isalnum()


def test_every_response_carries_a_trace_id_including_failures(client: TestClient) -> None:
    # Given: a request that fails validation.

    # When: it is rejected.
    response = client.get("/api/v1/sync-jobs/not-a-uuid")

    # Then: a failed request is still traceable.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert response.headers[REQUEST_ID_HEADER]


def test_two_requests_receive_different_generated_trace_ids(client: TestClient) -> None:
    # Given: two untraced requests.

    # When: both are answered.
    first = client.get(STATUS_PATH).headers[REQUEST_ID_HEADER]
    second = client.get(STATUS_PATH).headers[REQUEST_ID_HEADER]

    # Then: one operator search never mixes two requests together.
    assert first != second


def test_the_trace_id_is_unset_outside_a_request() -> None:
    # Given: code running outside any request.

    # When / Then: logging still works, with a placeholder instead of a stale id.
    assert get_request_id() == UNSET_REQUEST_ID


def test_the_trace_id_is_released_after_use() -> None:
    # Given: a bound trace id.
    token = set_request_id("trace-1")
    assert get_request_id() == "trace-1"

    # When: the request finishes.
    reset_request_id(token)

    # Then: it does not leak into the next piece of work.
    assert get_request_id() == UNSET_REQUEST_ID


def test_generated_trace_ids_are_unique() -> None:
    # Given: many generated ids.
    generated = {new_request_id() for _ in range(100)}

    # When / Then: requests never collide in the logs.
    assert len(generated) == 100


def test_a_missing_client_trace_id_produces_a_generated_one() -> None:
    # Given: no incoming header.

    # When: it is sanitized.
    result = sanitize_request_id(None)

    # Then: a usable id is always available to log against.
    assert result
    assert result.isalnum()


def test_log_records_carry_the_current_trace_id() -> None:
    # Given: a log record produced during a request.
    token = set_request_id("trace-log-1")
    record = logging.LogRecord("test", logging.INFO, __file__, 1, "message", None, None)

    # When: the filter stamps it.
    try:
        assert stamp_request_id(record) is True
    finally:
        reset_request_id(token)

    # Then: operators can search the log by request id.
    assert getattr(record, "request_id", None) == "trace-log-1"


def test_a_secret_is_logged_only_as_a_short_fingerprint() -> None:
    # Given: an Idempotency-Key the contract forbids logging in full.
    key = "approve-store-change-2026-08-08"

    # When: it is prepared for a log line.
    marker = fingerprint(key)

    # Then: it correlates repeat calls without revealing the value.
    assert key not in marker
    assert len(marker) == 12
    assert marker == fingerprint(key)
    assert marker != fingerprint(key + "x")


def test_job_context_links_a_log_line_to_a_job_and_platform() -> None:
    # Given: a job and one of its platform tasks.
    sync_job_id = UUID(SYNC_JOB_ID)

    # When: log context is built for each.
    job_only = job_context(sync_job_id)
    with_platform = job_context(sync_job_id, "naver")

    # Then: a request, its job and each platform task share one searchable trail.
    assert job_only == f"syncJobId={sync_job_id}"
    assert with_platform == f"syncJobId={sync_job_id} platform=naver"


def test_validation_failures_never_echo_the_submitted_value(client: TestClient) -> None:
    # Given: a request whose invalid field holds something that could be customer PII.
    secret_text = "고객 홍길동 010-1234-5678"  # noqa: S105 - sample PII, not a credential
    body = {
        "storeProfileId": str(uuid4()),
        "recognizedText": secret_text * 40,
        "locale": "ko-KR",
    }

    # When: the API rejects it.
    response = client.post("/api/v1/store-change-proposals", json=body)

    # Then: the response names the field but never repeats what was sent.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert secret_text not in response.text
    assert "recognizedText" in response.text


def test_an_idempotency_key_is_never_returned_in_an_error(client: TestClient) -> None:
    # Given: an approval whose key breaks the contract's character rule.
    key = "secret key value"

    # When: it is rejected.
    response = client.post(
        f"/api/v1/store-change-proposals/{SYNC_JOB_ID}/approve",
        headers={"Idempotency-Key": key},
    )

    # Then: the rejected key is not echoed back to the caller.
    assert response.status_code == status.HTTP_422_UNPROCESSABLE_CONTENT
    assert key not in response.text


def test_a_logger_gains_the_trace_filter_only_once() -> None:
    # Given: a logger requested twice by different modules.
    first = get_logger("mapkeeper.test.duplicate")
    second = get_logger("mapkeeper.test.duplicate")

    # When / Then: repeated calls do not stack duplicate filters onto one logger.
    assert first is second
    assert first.filters.count(stamp_request_id) == 1


def test_configured_logging_stamps_the_trace_id(capsys: pytest.CaptureFixture[str]) -> None:
    # Given: logging configured as the application configures it on start.
    configure_logging("INFO")
    token = set_request_id("trace-configured")

    # When: a line is written during a request.
    try:
        logging.getLogger("mapkeeper.test.configured").info("job accepted")
    finally:
        reset_request_id(token)

    # Then: an operator can find the line by request id.
    assert "trace-configured" in capsys.readouterr().err
