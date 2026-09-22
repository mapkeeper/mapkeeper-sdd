"""The official Korean holiday table UC1 resolves 추석·설 연휴 against."""

import json
from datetime import date
from typing import Final

from mapkeeper.adapters.holiday_calendar import (
    BundledHolidayCalendar,
    load_bundled_calendar,
    parse_holiday_table,
)

CHUSEOK: Final = "추석"
SEOLLAL: Final = "설날"


def test_the_upcoming_chuseok_comes_from_the_table_not_from_a_guess() -> None:
    # Given: the table shipped with the service.
    calendar = load_bundled_calendar()

    # When: the occurrence that has not finished yet is asked for.
    event = calendar.occurrence(CHUSEOK, date(2026, 9, 22))

    # Then: it is the officially published 2026 연휴, with the day itself named
    # separately - "추석 연휴" and "추석 당일" are two different closures.
    assert event is not None
    assert event.start_date == date(2026, 9, 24)
    assert event.end_date == date(2026, 9, 26)
    assert event.observance_date == date(2026, 9, 25)


def test_an_occurrence_already_over_is_not_offered_again() -> None:
    # Given: a reference date after the 2026 연휴 has ended.
    calendar = load_bundled_calendar()

    # When: the next occurrence is asked for.
    event = calendar.occurrence(CHUSEOK, date(2026, 9, 27))

    # Then: the following year's is returned rather than a closure in the past.
    assert event is not None
    assert event.start_date == date(2027, 9, 14)
    assert event.observance_date == date(2027, 9, 15)


def test_a_substitute_holiday_is_part_of_the_period_it_extends() -> None:
    # Given: 2025's 추석, whose first day fell on a Sunday.
    calendar = load_bundled_calendar()

    # When: the occurrence is read.
    event = calendar.occurrence(CHUSEOK, date(2025, 9, 1))

    # Then: the 대체공휴일 is inside the period, because a store closing for the
    # 연휴 closes for that day too.
    assert event is not None
    assert event.start_date == date(2025, 10, 5)
    assert event.end_date == date(2025, 10, 8)
    assert event.observance_date == date(2025, 10, 6)


def test_a_year_the_table_does_not_cover_has_no_occurrence() -> None:
    # Given: a reference date past the last published year.
    calendar = load_bundled_calendar()

    # When / Then: the lookup says it does not know rather than extrapolating a
    # lunar date, which is what keeps an invented closure off three public maps.
    assert calendar.occurrence(CHUSEOK, date(2032, 1, 1)) is None


def test_the_table_carries_both_holidays_it_claims_to_cover() -> None:
    # Given: the bundled table.
    calendar = load_bundled_calendar()

    # When / Then: 설날 is resolvable too, not only the reported 추석.
    event = calendar.occurrence(SEOLLAL, date(2025, 1, 2))
    assert event is not None
    assert event.start_date == date(2025, 1, 28)
    assert event.end_date == date(2025, 1, 30)
    assert event.observance_date == date(2025, 1, 29)


def test_every_published_event_is_a_range_a_closure_can_use() -> None:
    # Given: every row in the table.
    events = load_bundled_calendar().events

    # Then: each one is ordered, contains its own observance day and names where
    # it came from, so a proposal built from it can be traced back.
    assert events
    for event in events:
        assert event.start_date <= event.observance_date <= event.end_date
        assert event.title
        assert event.source_url
    assert list(events) == sorted(events, key=lambda event: event.start_date)


def test_an_unreadable_table_degrades_to_a_calendar_that_knows_nothing() -> None:
    # Given: a data file that is not the table it should be.
    # When: it is read.
    events = parse_holiday_table("{ not json")

    # Then: the service starts with no holiday knowledge instead of failing, and
    # every sentence naming one falls back to the existing date clarification.
    assert events == ()


def test_a_row_whose_day_is_outside_its_own_period_is_dropped() -> None:
    # Given: a table row that contradicts itself - the day it names is not inside
    # the period it publishes, so "당일" and "연휴" would disagree.
    raw = json.dumps(
        {
            "source": "테스트",
            "sourceUrl": "https://example.invalid/holidays",
            "retrievedAt": "2026-09-22",
            "coveredYears": [2026],
            "events": [
                {
                    "title": CHUSEOK,
                    "startDate": "2026-09-24",
                    "endDate": "2026-09-26",
                    "observanceDate": "2026-10-01",
                }
            ],
        }
    )

    # When: the table is read.
    # Then: the row is left out rather than published as two different answers.
    assert parse_holiday_table(raw) == ()


def test_a_readable_row_survives_the_consistency_check() -> None:
    # Given: the same table with the day back inside its period.
    raw = json.dumps(
        {
            "source": "테스트",
            "sourceUrl": "https://example.invalid/holidays",
            "retrievedAt": "2026-09-22",
            "coveredYears": [2026],
            "events": [
                {
                    "title": CHUSEOK,
                    "startDate": "2026-09-24",
                    "endDate": "2026-09-26",
                    "observanceDate": "2026-09-25",
                }
            ],
        }
    )

    # When / Then: it is published with the source it came from attached.
    (event,) = parse_holiday_table(raw)
    assert event.observance_date == date(2026, 9, 25)
    assert event.source_url == "https://example.invalid/holidays"


def test_a_missing_data_file_is_not_a_startup_failure() -> None:
    # Given: a resource name that is not packaged.
    calendar = load_bundled_calendar(resource="no-such-holiday-table.json")

    # When / Then: lookups simply have no answer.
    assert calendar.events == ()
    assert calendar.occurrence(CHUSEOK, date(2026, 9, 22)) is None


def test_an_empty_calendar_answers_nothing() -> None:
    # Given: a calendar built with no events at all.
    calendar = BundledHolidayCalendar(events=())

    # When / Then: no title resolves.
    assert calendar.occurrence(CHUSEOK, date(2026, 9, 22)) is None
