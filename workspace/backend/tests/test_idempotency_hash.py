"""T219: what makes two approval requests "the same" is decided by these hashes."""

import re
from typing import Final
from uuid import UUID

import pytest

from mapkeeper.core.json_types import JsonValue
from mapkeeper.services.idempotency import (
    REQUEST_HASH_LENGTH,
    generation_request_hash,
    proposal_request_hash,
)

PROPOSAL_ID: Final = UUID("22222222-2222-4222-8222-222222222222")
OTHER_PROPOSAL_ID: Final = UUID("22222222-2222-4222-8222-222222222223")
GENERATION_ID: Final = UUID("33333333-3333-4333-8333-333333333333")
HEX_64: Final = re.compile(r"^[0-9a-f]{64}$")

CHANGES: Final[JsonValue] = [
    {
        "field": "businessHours",
        "currentValue": {"open": "09:00", "close": "22:00"},
        "proposedValue": {"open": "09:00", "close": "20:00"},
    }
]
OTHER_CHANGES: Final[JsonValue] = [
    {
        "field": "businessHours",
        "currentValue": {"open": "09:00", "close": "22:00"},
        "proposedValue": {"open": "09:00", "close": "21:00"},
    }
]


@pytest.mark.parametrize(
    "digest",
    [
        proposal_request_hash(PROPOSAL_ID, CHANGES),
        generation_request_hash(GENERATION_ID, 1),
    ],
)
def test_a_request_hash_is_a_sha256_hex_digest(digest: str) -> None:
    # Given: one approval hash.

    # When / Then: it fits the char(64) column the Data Model defines.
    assert len(digest) == REQUEST_HASH_LENGTH
    assert HEX_64.match(digest)


def test_the_same_uc1_approval_always_hashes_the_same() -> None:
    # Given: the same proposal approved with the same changes.

    # When / Then: a retried call is recognised as a replay.
    assert proposal_request_hash(PROPOSAL_ID, CHANGES) == proposal_request_hash(
        PROPOSAL_ID, CHANGES
    )


def test_a_uc1_hash_changes_with_the_proposal() -> None:
    # Given: the same changes on two different proposals.

    # When / Then: one key cannot approve a different proposal.
    assert proposal_request_hash(PROPOSAL_ID, CHANGES) != proposal_request_hash(
        OTHER_PROPOSAL_ID, CHANGES
    )


def test_a_uc1_hash_changes_with_the_approved_content() -> None:
    # Given: the same proposal with different approved changes.

    # When / Then: editing before approval makes it a different request.
    assert proposal_request_hash(PROPOSAL_ID, CHANGES) != proposal_request_hash(
        PROPOSAL_ID, OTHER_CHANGES
    )


def test_a_uc1_hash_ignores_key_ordering_inside_the_changes() -> None:
    # Given: the same change with its JSON keys written in another order.
    reordered: JsonValue = [
        {
            "proposedValue": {"close": "20:00", "open": "09:00"},
            "currentValue": {"close": "22:00", "open": "09:00"},
            "field": "businessHours",
        }
    ]

    # When / Then: serialization order never turns a replay into a conflict.
    assert proposal_request_hash(PROPOSAL_ID, CHANGES) == proposal_request_hash(
        PROPOSAL_ID, reordered
    )


def test_the_same_uc2_approval_always_hashes_the_same() -> None:
    # Given: the same generation at the same revision.

    # When / Then: a retried approval is recognised as a replay.
    assert generation_request_hash(GENERATION_ID, 2) == generation_request_hash(GENERATION_ID, 2)


def test_a_uc2_hash_changes_when_the_generation_is_regenerated() -> None:
    # Given: the same generation before and after a regenerate.

    # When / Then: approving new results under an old key is a different request.
    assert generation_request_hash(GENERATION_ID, 1) != generation_request_hash(GENERATION_ID, 2)


def test_uc1_and_uc2_hashes_never_collide() -> None:
    # Given: a proposal and a generation sharing an id value.
    shared = UUID("44444444-4444-4444-8444-444444444444")

    # When / Then: the source type is part of what is hashed.
    assert proposal_request_hash(shared, []) != generation_request_hash(shared, 1)


def test_hashing_is_stable_across_unicode_content() -> None:
    # Given: approved changes carrying Korean text.
    korean: JsonValue = [
        {
            "field": "representativeMenuName",
            "currentValue": "아메리카노",
            "proposedValue": "수제 바닐라라테",
        }
    ]

    # When / Then: the digest is reproducible for non-ASCII values too.
    assert proposal_request_hash(PROPOSAL_ID, korean) == proposal_request_hash(PROPOSAL_ID, korean)
