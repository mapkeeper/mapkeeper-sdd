"""The deterministic intent parser that runs before any Gemini call."""

from datetime import date
from typing import Final
from uuid import uuid4

import pytest

from mapkeeper.adapters.intent import parse_intent
from mapkeeper.api.schemas.store_change import (
    BusinessHoursChange,
    ParkingInfoChange,
    RepresentativeMenuNameChange,
    TemporaryClosureChange,
)
from mapkeeper.models import StoreProfile

HOURS: Final = {"open": "09:00", "close": "22:00"}


def make_profile() -> StoreProfile:
    """Return a store open 09:00 to 22:00 selling 만두전골."""
    return StoreProfile(
        id=uuid4(),
        store_name="만두전골 하우스",
        public_address="서울특별시 관악구 시연로 12",
        business_hours=dict(HOURS),
        representative_menu_name="만두전골",
        representative_phone="02-000-0000",
        platform_account_refs={},
    )


# --- representative menu -------------------------------------------------------


@pytest.mark.parametrize(
    ("sentence", "expected"),
    [
        ("메뉴를 고기 만두로 바꿔줘", "고기 만두"),
        ("대표 메뉴를 고기만두로 변경해줘", "고기만두"),
        ("주력 메뉴를 김치찌개로 해줘", "김치찌개"),
        ("대표 메뉴명을 고기 만두로 바꿔줘", "고기 만두"),
        ("대표메뉴를 수제 바닐라라테로 변경", "수제 바닐라라테"),
    ],
)
def test_natural_menu_phrasings_become_a_menu_change(sentence: str, expected: str) -> None:
    # Given: a sentence naming a new representative menu.
    profile = make_profile()

    # When: the deterministic parser reads it.
    changes = parse_intent(sentence, profile)

    # Then: the menu name is taken verbatim, spaces included.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, RepresentativeMenuNameChange)
    assert change.proposed_value == expected
    assert change.current_value == "만두전골"


def test_a_menu_name_over_the_limit_is_not_parsed_deterministically() -> None:
    # Given: a menu name longer than the contract allows.
    sentence = f"대표 메뉴를 {'가' * 51}로 바꿔줘"

    # When / Then: the parser declines rather than emitting an invalid change.
    assert parse_intent(sentence, make_profile()) is None


def test_an_empty_menu_name_is_not_parsed_deterministically() -> None:
    # Given: a sentence with the keyword but no actual name.
    # When / Then: nothing is invented.
    assert parse_intent("대표 메뉴를 로 바꿔줘", make_profile()) is None


@pytest.mark.parametrize(
    "sentence",
    [
        "대표 메뉴를 김치찌개와 냉면으로 바꿔줘",
        "대표 메뉴를 김치찌개 및 만두전골로 변경해줘",
        "대표 메뉴를 김치찌개 그리고 냉면으로 바꿔줘",
    ],
)
def test_multiple_menu_names_are_not_parsed_as_one_menu(sentence: str) -> None:
    # Given: a request that names more than one independent menu.
    # When / Then: the parser refuses to combine them into one representative name.
    assert parse_intent(sentence, make_profile()) is None


# --- parking info ---------------------------------------------------------------


@pytest.mark.parametrize(
    ("sentence", "expected"),
    [
        ("주차 정보를 건물 뒤 3대 가능으로 바꿔줘", "건물 뒤 3대 가능"),
        ("주차를 매장 앞 2대로 변경해줘", "매장 앞 2대"),
        ("주차공간을 발렛 전용으로 해줘", "발렛 전용"),
    ],
)
def test_natural_parking_phrasings_become_a_parking_change(sentence: str, expected: str) -> None:
    # Given: a sentence naming a new parking arrangement, with no parking on file yet.
    profile = make_profile()

    # When: the deterministic parser reads it.
    changes = parse_intent(sentence, profile)

    # Then: the value is taken verbatim and the current value is None.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, ParkingInfoChange)
    assert change.proposed_value == expected
    assert change.current_value is None


def test_a_parking_info_change_reads_the_profiles_current_value() -> None:
    # Given: a store that already has parking info on file.
    profile = make_profile()
    profile.parking_info = "건물 앞 2대 무료주차"

    # When: the deterministic parser reads a new request.
    changes = parse_intent("주차 정보를 건물 뒤 3대 가능으로 바꿔줘", profile)

    # Then: the current value comes from the stored profile, not None.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, ParkingInfoChange)
    assert change.current_value == "건물 앞 2대 무료주차"


def test_an_empty_parking_info_is_not_parsed_deterministically() -> None:
    # Given: a sentence with the keyword but no actual value.
    # When / Then: nothing is invented.
    assert parse_intent("주차 정보를 로 바꿔줘", make_profile()) is None


# --- business hours ------------------------------------------------------------


@pytest.mark.parametrize(
    ("sentence", "expected_open", "expected_close"),
    [
        ("영업시간을 오후 8시까지로 바꿔줘", "09:00", "20:00"),
        ("저녁 8시까지 영업해", "09:00", "20:00"),
        ("문을 오전 10시에 열어줘", "10:00", "22:00"),
        ("마감 시간을 밤 9시로 변경해줘", "09:00", "21:00"),
        ("아침 8시에 오픈할게", "08:00", "22:00"),
        ("새벽 2시까지 영업합니다", "09:00", "02:00"),
        ("영업시간을 밤 12시까지로 바꿔줘", "09:00", "00:00"),
        ("영업시간을 오전 10시 30분에 열어줘", "10:30", "22:00"),
    ],
)
def test_korean_clock_expressions_become_24_hour_times(
    sentence: str,
    expected_open: str,
    expected_close: str,
) -> None:
    # Given: a sentence about opening or closing time.
    profile = make_profile()

    # When: the deterministic parser reads it.
    changes = parse_intent(sentence, profile)

    # Then: the spoken side of the day moves and the other side is preserved.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, BusinessHoursChange)
    assert change.proposed_value.open == expected_open
    assert change.proposed_value.close == expected_close


def test_an_impossible_clock_time_is_not_parsed_deterministically() -> None:
    # Given: a sentence naming an hour that does not exist.
    # When / Then: the parser declines rather than emitting a broken value.
    assert parse_intent("영업시간을 오후 25시까지로 바꿔줘", make_profile()) is None


# --- temporary closure ---------------------------------------------------------


def test_two_explicit_dates_become_a_closure_change() -> None:
    # Given: a closure request carrying both dates in the contract's format.
    sentence = "2026-08-15 부터 2026-08-17 까지 휴무입니다"

    # When: the deterministic parser reads it.
    changes = parse_intent(sentence, make_profile())

    # Then: the range is taken exactly as written.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, TemporaryClosureChange)
    assert change.proposed_value.start_date == date(2026, 8, 15)
    assert change.proposed_value.end_date == date(2026, 8, 17)


@pytest.mark.parametrize(
    ("sentence", "expected_start", "expected_end"),
    [
        ("8월 15일 임시 휴무로 해줘", date(2026, 8, 15), date(2026, 8, 15)),
        ("8월 15일부터 8월 17일까지 쉬어요", date(2026, 8, 15), date(2026, 8, 17)),
        ("2026년 8월 15일부터 8월 17일까지 휴무", date(2026, 8, 15), date(2026, 8, 17)),
    ],
)
def test_korean_dates_become_contract_date_ranges(
    sentence: str,
    expected_start: date,
    expected_end: date,
) -> None:
    # Given: a closure request using Korean month and day words.
    # When: the parser resolves it against the current year.
    changes = parse_intent(sentence, make_profile(), today=date(2026, 8, 3))

    # Then: the dates are converted to validated contract dates.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, TemporaryClosureChange)
    assert change.proposed_value.start_date == expected_start
    assert change.proposed_value.end_date == expected_end


@pytest.mark.parametrize(
    ("sentence", "expected_start", "expected_end"),
    [
        ("다음 주쯤 쉬어요", date(2026, 8, 10), date(2026, 8, 16)),
        ("내일 휴무예요", date(2026, 8, 4), date(2026, 8, 4)),
        ("내일 하루 쉴게", date(2026, 8, 4), date(2026, 8, 4)),
        ("내일부터 사흘 쉴게", date(2026, 8, 4), date(2026, 8, 6)),
        ("내일 이틀 휴무", date(2026, 8, 4), date(2026, 8, 5)),
        ("모레 3일간 쉬어요", date(2026, 8, 5), date(2026, 8, 7)),
        ("다음 주 화요일 문 닫아", date(2026, 8, 11), date(2026, 8, 11)),
    ],
)
def test_supported_relative_closure_dates_are_resolved(
    sentence: str,
    expected_start: date,
    expected_end: date,
) -> None:
    # Given: a closure request with a supported relative date.
    # When: the parser resolves it against a known current date.
    changes = parse_intent(sentence, make_profile(), today=date(2026, 8, 3))

    # Then: the relative expression becomes an exact contract date range.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, TemporaryClosureChange)
    assert change.proposed_value.start_date == expected_start
    assert change.proposed_value.end_date == expected_end


@pytest.mark.parametrize("sentence", ["이번 달 15일부터 쉴게요", "2026-08-15 부터 휴무입니다"])
def test_an_incomplete_closure_date_is_never_guessed(sentence: str) -> None:
    # Given: a closure request whose dates cannot be pinned down.
    # When / Then: the parser declines rather than inventing a date.
    assert parse_intent(sentence, make_profile(), today=date(2026, 8, 3)) is None


def test_a_closure_ending_before_it_starts_is_not_parsed_deterministically() -> None:
    # Given: a range the contract forbids.
    sentence = "2026-08-17 부터 2026-08-15 까지 휴무"

    # When / Then: the schema's rule is respected, not bypassed.
    assert parse_intent(sentence, make_profile()) is None


# --- refusals ------------------------------------------------------------------


@pytest.mark.parametrize(
    "sentence",
    [
        "대표 전화번호를 010-1234-5678로 바꿔줘",
        "주소를 강남으로 옮겨줘",
        "오늘 날씨 어때",
        "",
    ],
)
def test_sentences_outside_the_allowed_fields_are_not_parsed(sentence: str) -> None:
    # Given: a request naming a field the MVP does not support, or no request at all.

    # When / Then: the parser declines; it never widens the allow-list.
    assert parse_intent(sentence, make_profile()) is None


# --- edge cases in the clock conversion ----------------------------------------


@pytest.mark.parametrize(
    ("sentence", "expected_close"),
    [
        ("영업시간을 점심 12시까지로 바꿔줘", "12:00"),
        ("영업시간을 점심 1시까지로 바꿔줘", "13:00"),
        ("영업시간을 오전 12시까지로 바꿔줘", "00:00"),
        ("영업시간을 20시까지로 바꿔줘", "20:00"),
        # "오후 12시" as a closing time reads as midnight: owners commonly use
        # it the same way as "밤 12시" here, not as the grammatically literal
        # noon (see test_pm_twelve_means_noon_when_opening below).
        ("영업시간을 오후 12시까지로 바꿔줘", "00:00"),
        ("마감 시간을 오후 12시로 늘려줘", "00:00"),
    ],
)
def test_remaining_meridiem_forms_convert(sentence: str, expected_close: str) -> None:
    # Given: a clock expression using the less common Korean forms.

    # When: the deterministic parser reads it.
    changes = parse_intent(sentence, make_profile())

    # Then: each resolves to the hour a shop owner would mean.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, BusinessHoursChange)
    assert change.proposed_value.close == expected_close


def test_pm_twelve_means_noon_when_opening() -> None:
    # Given: "오후 12시" naming an opening time instead of a closing time.

    # When: the deterministic parser reads it.
    changes = parse_intent("문을 오후 12시에 열어줘", make_profile())

    # Then: the grammatical reading (noon) holds, unlike the closing case
    # above, since "오후 12시에 열어요" is not ambiguous the way a closing
    # time is.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, BusinessHoursChange)
    assert change.proposed_value.open == "12:00"


@pytest.mark.parametrize(
    "sentence",
    [
        "영업시간을 오전 13시까지로 바꿔줘",
        "영업시간을 점심 13시까지로 바꿔줘",
        "영업시간을 8시 70분까지로 바꿔줘",
    ],
)
def test_out_of_range_clock_values_are_declined(sentence: str) -> None:
    # Given: an hour or minute outside the clock.

    # When / Then: the parser hands the sentence on instead of emitting a bad value.
    assert parse_intent(sentence, make_profile()) is None


def test_a_profile_with_unusable_hours_is_declined() -> None:
    # Given: a stored profile whose business hours do not match the schema.
    profile = make_profile()
    profile.business_hours = {"open": "not-a-time"}

    # When / Then: the parser declines rather than raising mid-request.
    assert parse_intent("영업시간을 오후 8시까지로 바꿔줘", profile) is None


def test_a_closure_with_an_impossible_date_is_declined() -> None:
    # Given: a date in the right shape but not on the calendar.
    sentence = "2026-02-30 부터 2026-03-01 까지 휴무"

    # When / Then: the parser declines rather than emitting a broken range.
    assert parse_intent(sentence, make_profile()) is None
