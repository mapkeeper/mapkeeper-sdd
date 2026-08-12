"""Checks on the demo seed values that need no database.

The safety rules matter more than the wording: the seed must never carry customer
PII or a usable credential, because it is committed and shown in demos.
"""

import re
from typing import Final

import pytest

from mapkeeper.core.json_types import JsonObject, JsonValue
from mapkeeper.db.seed import (
    DEMO_MASKED_REVIEWS,
    DEMO_PLATFORM_ACCOUNT_REFS,
    DEMO_SOURCE_REVIEW_IDS,
    build_source_reviews,
    build_store_profile,
)

SOURCE_REVIEW_IDS_MAX: Final = 10
KOREAN_MOBILE_PATTERN: Final = re.compile(r"01[016789][-\s]?\d{3,4}[-\s]?\d{4}")
EMAIL_PATTERN: Final = re.compile(r"[\w.+-]+@[\w-]+\.[\w.]+")
RESIDENT_NUMBER_PATTERN: Final = re.compile(r"\d{6}[-\s]?[1-4]\d{6}")
CREDENTIAL_KEY_PATTERN: Final = re.compile(
    r"token|secret(?!Ref)|password|passwd|api[_-]?key|client[_-]?secret|refresh",
    re.IGNORECASE,
)


def _flatten(value: JsonValue, path: str = "") -> list[tuple[str, JsonValue]]:
    if isinstance(value, dict):
        return [item for key, child in value.items() for item in _flatten(child, f"{path}.{key}")]
    if isinstance(value, list):
        return [
            item
            for index, child in enumerate(value)
            for item in _flatten(child, f"{path}[{index}]")
        ]
    return [(path, value)]


def test_the_demo_store_carries_no_temporary_closure() -> None:
    # Given: the seeded store profile.
    profile = build_store_profile()

    # When / Then: the demo starts from a normal open period.
    assert profile.temporary_closure_start_date is None
    assert profile.temporary_closure_end_date is None


def test_the_demo_store_respects_the_contract_field_limits() -> None:
    # Given: the seeded store profile.
    profile = build_store_profile()

    # When / Then: seeded values stay inside the limits the API publishes.
    assert 1 <= len(profile.representative_menu_name) <= 50
    assert profile.store_name
    assert profile.public_address


def test_the_demo_business_hours_use_the_contract_shape() -> None:
    # Given: the seeded business hours.
    hours = build_store_profile().business_hours

    # When / Then: they use the HH:mm open and close pair UC1 proposes changes against.
    assert set(hours) == {"open", "close"}
    for value in hours.values():
        assert isinstance(value, str)
        assert re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", value)


@pytest.mark.parametrize("platform", ["google", "naver", "kakao"])
def test_platform_account_refs_cover_every_platform(platform: str) -> None:
    # Given: the seeded account references.
    refs: JsonObject = DEMO_PLATFORM_ACCOUNT_REFS

    # When / Then: each platform the MVP syncs to has an entry.
    assert platform in refs


def test_platform_account_refs_hold_references_and_never_credentials() -> None:
    # Given: every leaf value of the seeded account references.
    leaves = _flatten(DEMO_PLATFORM_ACCOUNT_REFS)

    # When: keys that would name a credential are collected.
    credential_keys = [path for path, _ in leaves if CREDENTIAL_KEY_PATTERN.search(path)]

    # Then: only public ids and secret manager references are stored.
    assert credential_keys == []
    for path, value in leaves:
        assert isinstance(value, str), path
        if path.endswith("credentialRef"):
            assert value.startswith("sm://"), path


def test_masked_reviews_contain_no_customer_pii() -> None:
    # Given: the seeded review bodies.

    # When / Then: no phone number, email or resident number survives masking.
    for body in DEMO_MASKED_REVIEWS:
        assert not KOREAN_MOBILE_PATTERN.search(body), body
        assert not EMAIL_PATTERN.search(body), body
        assert not RESIDENT_NUMBER_PATTERN.search(body), body


def test_masked_reviews_show_that_masking_happened() -> None:
    # Given: the seeded review bodies.

    # When: bodies carrying a masking marker are counted.
    masked = [body for body in DEMO_MASKED_REVIEWS if "[" in body and "]" in body]

    # Then: the demo visibly proves PII was replaced rather than never present.
    assert masked


def test_the_seed_provides_usable_uc2_review_references() -> None:
    # Given: the seeded reviews.
    reviews = build_source_reviews()

    # When / Then: ids are unique, and the seed contains enough reviews for the demo.
    assert len(reviews) == len(DEMO_SOURCE_REVIEW_IDS)
    assert len({review.id for review in reviews}) == len(reviews)
    assert len(reviews) == 128
    assert len(DEMO_SOURCE_REVIEW_IDS) > SOURCE_REVIEW_IDS_MAX
    assert len(reviews) >= SOURCE_REVIEW_IDS_MAX
    for review in reviews:
        assert review.body_masked.strip()


def test_seeded_reviews_belong_to_the_seeded_store() -> None:
    # Given: the seeded profile and reviews.
    profile = build_store_profile()
    reviews = build_source_reviews()

    # When / Then: UC2 can reference them without an ownership failure.
    assert all(review.store_profile_id == profile.id for review in reviews)


def test_building_the_seed_twice_produces_the_same_ids() -> None:
    # Given: two independent builds of the seed.
    first = build_store_profile()
    second = build_store_profile()

    # When / Then: fixed ids are what make re-running the seed safe.
    assert first.id == second.id
    assert [review.id for review in build_source_reviews()] == list(DEMO_SOURCE_REVIEW_IDS)
