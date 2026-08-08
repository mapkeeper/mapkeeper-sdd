"""Safety and deterministic behavior tests for the UC1 Gemini boundary."""

from uuid import uuid4

import pytest

from mapkeeper.adapters.gemini import DeterministicGeminiStub
from mapkeeper.core.errors import MapKeeperError
from mapkeeper.models import StoreProfile
from mapkeeper.services.pii_masking import mask_customer_pii


def _profile() -> StoreProfile:
    """Build an in-memory profile for the offline model tests."""
    return StoreProfile(
        id=uuid4(),
        store_name="테스트 매장",
        public_address="서울시",
        business_hours={"open": "09:00", "close": "22:00"},
        representative_menu_name="만두전골",
        representative_phone="02-0000-0000",
        platform_account_refs={},
    )


@pytest.mark.asyncio
async def test_gemini_boundary_receives_masked_text_and_preserves_business_hours() -> None:
    # Given: a sentence containing customer PII and public business hours.
    stub = DeterministicGeminiStub()

    # When: the already-masked sentence is passed to the deterministic adapter.
    original = "영업시간은 오후 8시까지, 고객 이름은 홍길동, 전화 010-1234-5678"
    masked = mask_customer_pii(original)
    _ = await stub.generate(masked, _profile())

    # Then: PII is absent while business hours remain readable at the model boundary.
    assert "홍길동" not in stub.last_input
    assert "010-1234-5678" not in stub.last_input
    assert "오후 8시" in stub.last_input


@pytest.mark.asyncio
async def test_ambiguous_time_is_rejected() -> None:
    # Given: a request with no precise clock value.
    stub = DeterministicGeminiStub()

    # When / Then: the model boundary refuses to invent a time.
    with pytest.raises(MapKeeperError):
        _ = await stub.generate("영업시간을 저녁까지로 바꿔줘", _profile())


@pytest.mark.asyncio
async def test_invalid_closure_date_is_rejected() -> None:
    # Given: an impossible calendar date.
    stub = DeterministicGeminiStub()

    # When / Then: the structured output boundary rejects it.
    with pytest.raises(MapKeeperError):
        _ = await stub.generate("8월 31일부터 2026-02-30까지 휴무", _profile())
