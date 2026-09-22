"""The deterministic intent parser that runs before any Gemini call."""

from datetime import date
from typing import Final
from uuid import uuid4

import pytest

from mapkeeper.adapters.intent import parse_intent, unmapped_request_labels
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
        # A named weekday inside the current week is one day, not the whole week.
        # Reading it as the week closed the store for seven days, and pairing it
        # with a duration closed the Monday the owner never mentioned.
        ("이번 주 금요일에 쉽니다", date(2026, 8, 7), date(2026, 8, 7)),
        ("이번 주 금요일 하루만 휴무해", date(2026, 8, 7), date(2026, 8, 7)),
        # A week with no weekday named still covers the whole week.
        ("이번 주에 쉬어요", date(2026, 8, 3), date(2026, 8, 9)),
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


@pytest.mark.parametrize(
    "sentence",
    [
        "영업시간을 오전 10시부터 오후 9시까지로 바꿔줘",
        "아침 10시에 열고 저녁 9시에 닫아",
        "10시부터 21시까지 영업해",
    ],
)
def test_hours_stated_as_a_span_are_left_to_the_model(sentence: str) -> None:
    # Given: a sentence naming both ends of the day.

    # When / Then: the parser declines instead of reading the opening time as the
    # closing one, which would have inverted the day.
    assert parse_intent(sentence, make_profile()) is None


def test_a_single_stated_hour_is_still_parsed() -> None:
    # Given: only one end of the day is named, which this parser can read.
    change = parse_intent("오전 11시 오픈으로 변경해줘", make_profile())

    # Then: it is read locally, without a model round trip.
    assert change is not None
    assert isinstance(change[0], BusinessHoursChange)
    assert change[0].proposed_value.open == "11:00"


@pytest.mark.parametrize(
    ("sentence", "expected_start", "expected_end"),
    [
        # The second date omits the month it shares with the first.
        ("8월 25일부터 26일까지 쉬어요", date(2026, 8, 25), date(2026, 8, 26)),
        # The second end omits the week the first one named.
        ("다음 주 월요일부터 수요일까지 쉽니다", date(2026, 9, 7), date(2026, 9, 9)),
        ("이번 주 금요일부터 일요일까지 휴무", date(2026, 9, 4), date(2026, 9, 6)),
        ("내일부터 모레까지 쉽니다", date(2026, 9, 2), date(2026, 9, 3)),
        ("9월 1일부터 9월 3일까지 임시 휴무", date(2026, 9, 1), date(2026, 9, 3)),
    ],
)
def test_both_ends_of_a_stated_closure_range_are_structured(
    sentence: str,
    expected_start: date,
    expected_end: date,
) -> None:
    # Given: a range whose two ends are written in different shapes - the second
    # routinely drops the month or the week it shares with the first. Reading only
    # the first end closed the store for one day when the owner asked for three.

    # When: the parser reads it against a known current date.
    changes = parse_intent(sentence, make_profile(), today=date(2026, 9, 1))

    # Then: both the start and the end date are structured.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, TemporaryClosureChange)
    assert change.proposed_value.start_date == expected_start
    assert change.proposed_value.end_date == expected_end


@pytest.mark.parametrize(
    "sentence",
    ["8월 25일부터 다다음 주까지 쉬어요", "9월 1일부터 나중까지 쉽니다"],
)
def test_a_range_whose_far_end_cannot_be_read_is_declined(sentence: str) -> None:
    # Given: a range whose second end names no day this module can resolve.

    # When / Then: the parser declines rather than proposing the single day it can
    # see, which would reopen the store while the owner is away.
    assert parse_intent(sentence, make_profile(), today=date(2026, 9, 1)) is None


# --- official holiday periods --------------------------------------------------


@pytest.mark.parametrize(
    ("sentence", "today", "expected_start", "expected_end"),
    [
        # The reported sentence: a closure over the whole 연휴, said the ordinary
        # way. The store closes for every published day of the period.
        (
            "이번 추석 연휴에 문닫을 예정이야",
            date(2026, 9, 22),
            date(2026, 9, 24),
            date(2026, 9, 26),
        ),
        ("추석 연휴 전체 쉽니다", date(2026, 9, 22), date(2026, 9, 24), date(2026, 9, 26)),
        ("추석 연휴 동안 휴무입니다", date(2026, 9, 22), date(2026, 9, 24), date(2026, 9, 26)),
        # The day itself, which is a different closure from the period.
        ("추석 당일만 쉽니다", date(2026, 9, 22), date(2026, 9, 25), date(2026, 9, 25)),
        ("추석 당일 하루 문 닫습니다", date(2026, 9, 22), date(2026, 9, 25), date(2026, 9, 25)),
        # A different year and a different holiday, so the answer cannot be one
        # hardcoded date: 2025's 추석 carries a 대체공휴일 the period includes.
        ("추석 연휴 전체 쉽니다", date(2025, 9, 1), date(2025, 10, 5), date(2025, 10, 8)),
        ("설 연휴에 문 닫습니다", date(2025, 1, 2), date(2025, 1, 28), date(2025, 1, 30)),
        ("설날 당일 쉽니다", date(2026, 1, 5), date(2026, 2, 17), date(2026, 2, 17)),
        # The period this year is already over, so "추석 연휴" is next year's.
        ("추석 연휴 전체 쉽니다", date(2026, 10, 1), date(2027, 9, 14), date(2027, 9, 16)),
    ],
)
def test_a_named_holiday_period_becomes_its_published_dates(
    sentence: str,
    today: date,
    expected_start: date,
    expected_end: date,
) -> None:
    # Given: a closure stated against the calendar rather than a date, which is
    # how an owner actually says it. Before this the sentence reached no reader
    # at all and came back as "며칠인지 알 수 없어요".

    # When: the parser reads it against a known current date.
    changes = parse_intent(sentence, make_profile(), today=today)

    # Then: the closure carries the exact published dates of that period.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, TemporaryClosureChange)
    assert change.proposed_value.start_date == expected_start
    assert change.proposed_value.end_date == expected_end


def test_a_duration_spoken_with_a_holiday_starts_at_the_period() -> None:
    # Given: a stated number of days counted from the start of the 연휴.
    # When: the parser reads it.
    changes = parse_intent("추석 연휴 이틀 쉽니다", make_profile(), today=date(2026, 9, 22))

    # Then: the duration the owner said wins over the published length.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, TemporaryClosureChange)
    assert change.proposed_value.start_date == date(2026, 9, 24)
    assert change.proposed_value.end_date == date(2026, 9, 25)


@pytest.mark.parametrize(
    ("sentence", "today"),
    [
        # The reported sentence without the 연휴: "이번 추석" is either the three-day
        # period or the day itself, and closing for the wrong one is published to
        # three public maps. It has to be asked about, not guessed.
        ("이번 추석 문닫을 예정이야", date(2026, 9, 22)),
        ("추석에 쉽니다", date(2026, 9, 22)),
        ("설날에 휴무입니다", date(2026, 1, 5)),
        # A period the table does not cover. Extrapolating a lunar date would be
        # inventing the closure rather than reading it.
        ("추석 연휴 전체 쉽니다", date(2032, 1, 1)),
        # A holiday that has already happened is not a closure to propose.
        ("지난 추석 연휴에 쉬었습니다", date(2026, 9, 22)),
    ],
)
def test_an_unpinned_holiday_closure_is_never_guessed(sentence: str, today: date) -> None:
    # Given: a sentence naming a holiday without saying which days of it.
    # When / Then: the parser declines, leaving the owner to be asked.
    assert parse_intent(sentence, make_profile(), today=today) is None


def test_a_holiday_word_alone_is_not_read_as_a_closure() -> None:
    # Given: a sentence that mentions the holiday but asks for something else.
    sentence = "대표 메뉴를 추석 한정 갈비찜으로 바꿔줘"

    # When: the parser reads it.
    changes = parse_intent(sentence, make_profile(), today=date(2026, 9, 22))

    # Then: only the menu changes. A holiday name is not a request to close.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, RepresentativeMenuNameChange)
    assert change.proposed_value == "추석 한정 갈비찜"


# --- conjugated closure verbs --------------------------------------------------


@pytest.mark.parametrize(
    "sentence",
    [
        "내일 하루 쉽니다",
        "내일 하루 쉽니다.",
        "내일은 쉼",
        "내일 휴업합니다",
        "내일 영업 안 해요",
    ],
)
def test_conjugated_closure_verbs_are_read_as_a_closure(sentence: str) -> None:
    # Given: the ordinary polite forms an owner actually speaks. "쉽니다" is not
    # "쉬" plus an ending, so the earlier stem list never matched it.
    # When: the parser reads the sentence against a known current date.
    changes = parse_intent(sentence, make_profile(), today=date(2026, 8, 27))

    # Then: it resolves to tomorrow rather than reaching the model and failing.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, TemporaryClosureChange)
    assert change.proposed_value.start_date == date(2026, 8, 28)
    assert change.proposed_value.end_date == date(2026, 8, 28)


# --- requests the changes do not cover -----------------------------------------


def test_a_compound_sentence_becomes_one_change_per_request() -> None:
    # Given: one sentence asking for two things at once.
    sentence = "9월 1일은 임시 휴무이고 주차는 불가능합니다"

    # When: the parser reads it.
    changes = parse_intent(sentence, make_profile(), today=date(2026, 8, 27))

    # Then: each request is its own change and nothing is left to report as
    # dropped. Reading only the closure made the owner say the second half again.
    assert changes is not None
    closure, parking = changes
    assert isinstance(closure, TemporaryClosureChange)
    assert closure.proposed_value.start_date == date(2026, 9, 1)
    assert isinstance(parking, ParkingInfoChange)
    assert parking.proposed_value == "주차 불가"
    assert unmapped_request_labels(sentence, changes) == ()


def test_a_second_topic_the_changes_miss_is_named() -> None:
    # Given: one sentence asking for two things, only one of which this module
    # reads - the hours half is a span it declines and leaves to the model.
    sentence = "다음 주 월요일 하루 임시 휴무이고 영업시간은 오전 10시부터 오후 9시까지입니다"
    changes = parse_intent(sentence, make_profile(), today=date(2026, 8, 27))
    assert changes is not None

    # When: the dropped topics are collected.
    # Then: the hours request is reported rather than silently disappearing.
    assert unmapped_request_labels(sentence, changes) == ("영업시간",)


def test_a_fully_covered_sentence_reports_nothing_dropped() -> None:
    # Given: a sentence whose only topic became a change.
    sentence = "대표 메뉴를 김치찌개로 바꿔줘"
    changes = parse_intent(sentence, make_profile())
    assert changes is not None

    # When / Then: no notice is raised for a request that was fully honoured.
    assert unmapped_request_labels(sentence, changes) == ()


def test_dropped_topics_are_reported_in_the_contracts_field_order() -> None:
    # Given: a sentence naming three fields and a change list covering one.
    sentence = "영업시간도 바꾸고 그날은 쉬고 주차도 안 되고 메뉴도 바꿔야 해요"
    changes = parse_intent("대표 메뉴를 김치찌개로 바꿔줘", make_profile())
    assert changes is not None

    # When / Then: the labels read in the order the contract lists the fields.
    assert unmapped_request_labels(sentence, changes) == ("영업시간", "임시 휴무", "주차 정보")


@pytest.mark.parametrize(
    "sentence",
    ["내일 문 닫아", "내일 하루 쉽니다", "메뉴를 고기 만두로 바꿔줘"],
)
def test_an_ordinary_single_request_reports_nothing_dropped(sentence: str) -> None:
    # Given: a sentence about exactly one field, phrased the way owners speak.
    changes = parse_intent(sentence, make_profile(), today=date(2026, 8, 27))
    assert changes is not None

    # When / Then: no notice is raised. "문 닫아" states a closure, not an hours
    # change, so it must not read as an hours request the proposal ignored.
    assert unmapped_request_labels(sentence, changes) == ()


def test_a_clock_span_does_not_hide_a_relative_closure() -> None:
    """ "10시부터 9시까지" is a clock span, not a date range.

    The unreadable-span guard exists for "8월 25일부터 26일까지", whose second date
    the date pattern cannot see. Applying it to a business day meant a sentence
    stating both a closure and the day's hours dropped the closure entirely.
    """
    # Given: one sentence naming a relative closure and a spoken business day.
    sentence = "다음 주 월요일 하루 임시 휴무이고 영업시간은 오전 10시부터 오후 9시까지입니다"

    # When: the parser reads it against a known current date.
    changes = parse_intent(sentence, make_profile(), today=date(2026, 8, 28))

    # Then: the closure is read. The hours span is still left to the model.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, TemporaryClosureChange)
    assert change.proposed_value.start_date == date(2026, 8, 31)
    assert change.proposed_value.end_date == date(2026, 8, 31)
    assert unmapped_request_labels(sentence, changes) == ("영업시간",)


# --- parking stated as availability ---------------------------------------------


@pytest.mark.parametrize(
    ("sentence", "expected"),
    [
        ("주차는 불가능합니다", "주차 불가"),
        ("주차 불가능해요", "주차 불가"),
        ("주차 안 됩니다", "주차 불가"),
        ("주차 공간이 없습니다", "주차 불가"),
        ("주차 가능합니다", "주차 가능"),
        ("주차 됩니다", "주차 가능"),
    ],
)
def test_parking_stated_as_availability_becomes_a_parking_change(
    sentence: str,
    expected: str,
) -> None:
    # Given: the way an owner actually states parking, which names no value to
    # copy the way "…으로 바꿔줘" does.
    changes = parse_intent(sentence, make_profile())

    # Then: it is read rather than reported as a request that was dropped.
    assert changes is not None
    (change,) = changes
    assert isinstance(change, ParkingInfoChange)
    assert change.proposed_value == expected


def test_no_parking_is_never_read_as_parking_available() -> None:
    # Given: "불가능" contains "가능". Reading the sentence the wrong way round
    # would publish "주차 가능" for a store that has none.
    changes = parse_intent("주차는 불가능합니다", make_profile())

    assert changes is not None
    assert changes[0].proposed_value == "주차 불가"


# --- clauses that are not separate requests -------------------------------------


@pytest.mark.parametrize(
    "sentence",
    ["10시에 시작하고 21시에 마감해", "오전 10시에 열고 밤 11시에 닫아요"],
)
def test_one_business_day_is_never_split_into_two_requests(sentence: str) -> None:
    # Given: a sentence whose two halves are the two ends of a single day.

    # When / Then: splitting it would keep one end and drop the other, publishing
    # a day the owner never stated, so the whole sentence is left to the model.
    assert parse_intent(sentence, make_profile()) is None


def test_a_compound_menu_and_parking_sentence_becomes_two_changes() -> None:
    # Given: a rename and a parking notice joined by a connective.
    sentence = "대표 메뉴를 김치찌개로 바꾸고 주차는 불가능합니다"

    # When: the parser reads it.
    changes = parse_intent(sentence, make_profile())

    # Then: both halves survive as their own change.
    assert changes is not None
    menu, parking = changes
    assert isinstance(menu, RepresentativeMenuNameChange)
    assert menu.proposed_value == "김치찌개"
    assert isinstance(parking, ParkingInfoChange)
    assert parking.proposed_value == "주차 불가"
    assert unmapped_request_labels(sentence, changes) == ()
