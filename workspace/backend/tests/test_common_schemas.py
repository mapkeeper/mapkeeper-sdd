from datetime import UTC, datetime

import pytest
from pydantic import ValidationError

from mapkeeper.api.schemas.common import ApiEnvelope, ApiError
from mapkeeper.models.enums import (
    ApiErrorCode,
    ApiResponseStatus,
    ContentGenerationStatus,
    PlatformSyncTaskStatus,
    ProposalStatus,
    SyncJobStatus,
)


def test_status_enums_keep_partial_success_on_sync_job_only() -> None:
    # Given: the API and domain status enums from the approved contract.
    expected_job_statuses = {
        "PENDING",
        "PROCESSING",
        "PARTIAL_SUCCESS",
        "SUCCESS",
        "FAILED",
        "RETRYING",
    }

    # When: their serialized values are inspected.
    job_statuses = {status.value for status in SyncJobStatus}
    task_statuses = {status.value for status in PlatformSyncTaskStatus}

    # Then: only the aggregate job can represent partial success.
    assert job_statuses == expected_job_statuses
    assert "PARTIAL_SUCCESS" not in task_statuses
    assert {status.value for status in ApiResponseStatus} == {
        "SUCCESS",
        "PROCESSING",
        "FAILED",
    }
    assert {status.value for status in ProposalStatus} == {"DRAFT", "APPROVED", "REJECTED"}
    assert {status.value for status in ContentGenerationStatus} == {
        "DRAFT",
        "APPROVED",
        "REJECTED",
    }


def test_success_envelope_rejects_an_error_body() -> None:
    # Given: a successful API response containing an error body.
    invalid_response = {
        "success": True,
        "status": "SUCCESS",
        "data": {"value": "ok"},
        "error": {"code": "INVALID_STATE", "message": "conflict"},
        "timestamp": datetime(2026, 8, 7, tzinfo=UTC),
    }

    # When / Then: parsing rejects the contradictory response.
    with pytest.raises(ValidationError):
        _ = ApiEnvelope[dict[str, str]].model_validate(invalid_response)


def test_failure_envelope_requires_an_error_body() -> None:
    # Given: a failed API response without an error body.
    invalid_response = {
        "success": False,
        "status": "FAILED",
        "data": None,
        "error": None,
        "timestamp": datetime(2026, 8, 7, tzinfo=UTC),
    }

    # When / Then: parsing rejects the incomplete failure response.
    with pytest.raises(ValidationError):
        _ = ApiEnvelope[dict[str, str]].model_validate(invalid_response)


def test_failure_envelope_serializes_the_contract_shape() -> None:
    # Given: a valid failed API response.
    timestamp = datetime(2026, 8, 7, tzinfo=UTC)
    envelope = ApiEnvelope[dict[str, str]](
        success=False,
        status=ApiResponseStatus.FAILED,
        data=None,
        error=ApiError(code=ApiErrorCode.VALIDATION_ERROR, message="invalid input"),
        timestamp=timestamp,
    )

    # When: it is serialized for an HTTP response.
    payload = envelope.model_dump(mode="json")

    # Then: the common API envelope names and values are preserved.
    assert payload == {
        "success": False,
        "status": "FAILED",
        "data": None,
        "error": {
            "code": "VALIDATION_ERROR",
            "message": "invalid input",
            "details": [],
            "retryable": None,
        },
        "timestamp": "2026-08-07T00:00:00Z",
    }
