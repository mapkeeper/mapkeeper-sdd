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


def test_customer_reference_and_unlabelled_road_address_are_masked() -> None:
    # Given: a review identifies one customer before the label and includes a road address.
    original = (
        "홍길동 고객님이 서울특별시 강남구 테헤란로 1에서 방문했고 영업시간은 09:00-22:00입니다."
    )

    # When: the review crosses the model privacy boundary.
    masked = mask_customer_pii(original)

    # Then: customer identity and address disappear while public hours stay usable.
    assert "홍길동" not in masked
    assert "테헤란로 1" not in masked
    assert "09:00-22:00" in masked


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
async def test_night_clock_is_converted_to_24_hour_time_by_the_offline_fallback() -> None:
    # Given: the direct offline fallback receives a Korean night-time expression.
    stub = DeterministicGeminiStub()

    # When: it structures the business-hours change.
    changes = await stub.generate("영업시간을 밤 10시까지로 바꿔줘", _profile())

    # Then: 10 at night is 22:00, never 10:00.
    change = changes[0]
    assert change.field == "businessHours"
    assert change.proposed_value.close == "22:00"


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


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sentence", "expected_open", "expected_close"),
    [
        ("영업시간을 10시부터 23시까지로 바꿔주세요", "10:00", "23:00"),
        ("영업시간을 11시에서 21시로 바꿔주세요", "11:00", "21:00"),
        ("영업시간을 오전 10시부터 오후 9시까지로 바꿔줘", "10:00", "21:00"),
        ("영업시간 10시~21시로 변경", "10:00", "21:00"),
        # The sentence labels each end instead of separating them. That says
        # which clock opens the day just as plainly as "부터 ... 까지" does.
        ("영업시간은 아침 10시에 열고 저녁 9시에 닫아", "10:00", "21:00"),
        # The ordinary spoken form, with no "영업시간" anywhere in it.
        ("오전 10시에 열고 밤 11시에 닫아요", "10:00", "23:00"),
    ],
)
async def test_both_ends_of_a_stated_day_are_read_by_the_offline_fallback(
    sentence: str, expected_open: str, expected_close: str
) -> None:
    """Stating both ends of the day must change both ends of the day.

    The owner naming an opening and a closing time is the most ordinary way to
    change hours, and offline this fallback is the only reader. It used to take
    the first clock as the closing time and keep the stored opening time, so
    "10시부터 23시까지" proposed a store that opened at 09:00 and closed at
    10:00 — an inverted day, silently, on its way to three public maps.
    """
    # Given: a sentence naming when the store opens and when it closes.
    stub = DeterministicGeminiStub()

    # When: the offline fallback structures it.
    changes = await stub.generate(sentence, _profile())

    # Then: both ends are the ones the owner said.
    (change,) = changes
    assert change.field == "businessHours"
    assert change.proposed_value.open == expected_open
    assert change.proposed_value.close == expected_close


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sentence",
    [
        # Two clocks with neither a separator between them nor a word saying
        # which end each one is. Which one opens the day is a guess, and
        # guessing here inverts it.
        "영업시간은 10시 9시 이렇게 해줘",
        # Two clocks that name a break in the middle of the day, not its ends.
        "오후 3시 5시 브레이크타임이에요",
        # A span whose two ends are the same time is not a business day.
        "영업시간을 10시부터 10시까지로 바꿔줘",
    ],
)
async def test_hours_the_offline_fallback_cannot_assign_to_a_side_are_refused(
    sentence: str,
) -> None:
    # Given: a sentence naming two clock times this reader cannot place.
    stub = DeterministicGeminiStub()

    # When / Then: it refuses rather than proposing half of what was said.
    with pytest.raises(MapKeeperError):
        _ = await stub.generate(sentence, _profile())


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("sentence", "expected_field", "expected_value"),
    [
        # The sentence carries on into a second request. Everything after the
        # menu name used to stay part of the name.
        ("대표 메뉴를 김치찌개로 바꾸고 주차는 불가능합니다", "representativeMenuName", "김치찌개"),
        ("대표 메뉴를 김치찌개로 변경해줘", "representativeMenuName", "김치찌개"),
        ("대표 메뉴 김치찌개", "representativeMenuName", "김치찌개"),
        ("주차 정보를 매장 앞 3대 가능으로 바꿔줘", "parkingInfo", "매장 앞 3대 가능"),
        ("주차는 건물 뒤 3대 가능해요", "parkingInfo", "건물 뒤 3대 가능해요"),
    ],
)
async def test_free_text_value_stops_where_the_owner_stopped_saying_it(
    sentence: str, expected_field: str, expected_value: str
) -> None:
    """A free-text value is what was said, not the rest of the sentence.

    Offline this fallback is the only reader, and it took everything after the
    field keyword as the value. "대표 메뉴를 김치찌개로 바꾸고 주차는 불가능합니다"
    became a menu named "김치찌개로 바꾸고 주차는 불가능합니다" — under the 50
    character limit, so it validated, and one approval away from three public maps.
    """
    # Given: a sentence stating one free-text value.
    stub = DeterministicGeminiStub()

    # When: the offline fallback structures it.
    (change,) = await stub.generate(sentence, _profile())

    # Then: the value ends where the owner stopped stating it.
    assert change.field == expected_field
    assert change.proposed_value == expected_value


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "sentence",
    [
        # Two statements in one sentence. Keeping both would publish the second
        # one as parking information; keeping the first would drop it silently.
        "주차는 매장 앞 3대 가능하고 배달도 시작했어요",
        # No value at all — the keyword strip leaves only the particle behind.
        "주차 공간이 없어졌어요",
    ],
)
async def test_a_sentence_that_states_no_single_value_is_refused(sentence: str) -> None:
    # Given: a sentence the reader cannot reduce to one stated value.
    stub = DeterministicGeminiStub()

    # When / Then: it refuses instead of publishing the leftover text.
    with pytest.raises(MapKeeperError):
        _ = await stub.generate(sentence, _profile())


def test_the_customer_named_with_an_honorific_is_masked() -> None:
    """ "고객 홍길동님" is how an owner names a customer out loud.

    None of the earlier patterns saw that shape, so the name was stored on the
    proposal, returned in the API response and sent to Gemini in full.
    """
    # Given: a sentence naming a customer the ordinary way, beside a real request.
    original = "고객 홍길동님이 010-1234-5678로 예약했어요. 대표 메뉴를 김치찌개로 바꿔줘"

    # When: it crosses the model privacy boundary.
    masked = mask_customer_pii(original)

    # Then: the name and phone are gone and the request itself is untouched.
    assert "홍길동" not in masked
    assert "010-1234-5678" not in masked
    assert "대표 메뉴를 김치찌개로 바꿔줘" in masked


def test_the_stores_own_public_values_are_not_treated_as_customer_pii() -> None:
    """A store's published address and phone belong to the store.

    The constitution calls them approved business information. Masking them
    replaced the owner's own "여기로 찾아오세요" address with a placeholder, and in
    UC2 that placeholder is what approval publishes.
    """
    # Given: a sentence carrying the store's own public values and a customer's number.
    address = "서울특별시 관악구 시연로 12"
    phone = "02-000-0000"
    original = f"{address}로 찾아오세요. 문의는 {phone}. 손님 번호는 010-1234-5678입니다."

    # When: the store's published values are declared as business information.
    masked = mask_customer_pii(original, (address, phone))

    # Then: they survive while the customer's number is still masked.
    assert address in masked
    assert phone in masked
    assert "010-1234-5678" not in masked


def test_the_stores_own_public_address_survives_an_address_label() -> None:
    # Given: generated copy labels the store's approved address explicitly.
    address = "서울특별시 관악구 시연로 12"

    # When: the generated copy crosses the customer masking boundary.
    masked = mask_customer_pii(f"주소: {address}", (address,))

    # Then: the label does not turn the approved business value into a placeholder.
    assert masked == f"주소: {address}"
