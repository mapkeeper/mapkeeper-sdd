from datetime import date

import pytest
from pydantic import TypeAdapter, ValidationError

from mapkeeper.api.schemas.store_change import (
    BusinessHoursChange,
    CreateStoreChangeProposalRequest,
    PatchStoreChangeProposalRequest,
    ProposalChange,
    RepresentativeMenuNameChange,
    TemporaryClosureChange,
)


def test_proposal_change_parses_each_allowed_field_shape() -> None:
    # Given: one valid change for each field allowed by the MVP contract.
    payloads = (
        {
            "field": "businessHours",
            "currentValue": {"open": "09:00", "close": "22:00"},
            "proposedValue": {"open": "09:00", "close": "20:00"},
        },
        {
            "field": "temporaryClosure",
            "currentValue": None,
            "proposedValue": {"startDate": "2026-08-15", "endDate": "2026-08-17"},
        },
        {
            "field": "representativeMenuName",
            "currentValue": "아메리카노",
            "proposedValue": "수제 바닐라라테",
        },
    )
    adapter = TypeAdapter[ProposalChange](ProposalChange)

    # When: the discriminated union parses the payloads.
    changes = tuple(adapter.validate_python(payload) for payload in payloads)

    # Then: each field has its own strongly typed value model.
    assert isinstance(changes[0], BusinessHoursChange)
    assert isinstance(changes[1], TemporaryClosureChange)
    assert isinstance(changes[2], RepresentativeMenuNameChange)
    closure = changes[1]
    assert closure.proposed_value.start_date == date(2026, 8, 15)


def test_business_hours_rejects_non_hh_mm_values() -> None:
    # Given: a business-hours change using an invalid time format.
    payload = {
        "changes": [
            {
                "field": "businessHours",
                "currentValue": {"open": "9 AM", "close": "22:00"},
                "proposedValue": {"open": "09:00", "close": "20:00"},
            }
        ]
    }

    # When / Then: the API boundary rejects the ambiguous time.
    with pytest.raises(ValidationError):
        _ = PatchStoreChangeProposalRequest.model_validate(payload)


def test_temporary_closure_rejects_an_end_date_before_the_start_date() -> None:
    # Given: a temporary closure whose dates are reversed.
    payload = {
        "changes": [
            {
                "field": "temporaryClosure",
                "currentValue": None,
                "proposedValue": {"startDate": "2026-08-17", "endDate": "2026-08-15"},
            }
        ]
    }

    # When / Then: the API boundary rejects the invalid range.
    with pytest.raises(ValidationError):
        _ = PatchStoreChangeProposalRequest.model_validate(payload)


def test_proposal_change_rejects_an_unapproved_field() -> None:
    # Given: a change for a field outside the MVP allow-list.
    payload = {
        "changes": [
            {
                "field": "representativePhone",
                "currentValue": "010-0000-0000",
                "proposedValue": "010-1111-1111",
            }
        ]
    }

    # When / Then: the discriminated union rejects the field.
    with pytest.raises(ValidationError):
        _ = PatchStoreChangeProposalRequest.model_validate(payload)


def test_recognized_text_is_capped_at_five_hundred_characters() -> None:
    # Given: a recognized sentence one character over the contract limit.
    payload = {
        "storeProfileId": "11111111-1111-4111-8111-111111111111",
        "recognizedText": "가" * 501,
        "locale": "ko-KR",
    }

    # When / Then: the boundary is enforced at the API edge.
    with pytest.raises(ValidationError):
        _ = CreateStoreChangeProposalRequest.model_validate(payload)


def test_representative_menu_name_is_capped_at_fifty_characters() -> None:
    # Given: a proposed menu name one character over the contract limit.
    payload = {
        "changes": [
            {
                "field": "representativeMenuName",
                "currentValue": "아메리카노",
                "proposedValue": "가" * 51,
            }
        ]
    }

    # When / Then: the menu limit is enforced before anything is stored.
    with pytest.raises(ValidationError):
        _ = PatchStoreChangeProposalRequest.model_validate(payload)


def test_patch_rejects_duplicate_change_fields() -> None:
    # Given: a patch that repeats the same supported field.
    change = {
        "field": "businessHours",
        "currentValue": {"open": "09:00", "close": "22:00"},
        "proposedValue": {"open": "09:00", "close": "20:00"},
    }

    # When / Then: duplicate fields are rejected at the API boundary.
    with pytest.raises(ValidationError):
        _ = PatchStoreChangeProposalRequest.model_validate({"changes": [change, change]})
