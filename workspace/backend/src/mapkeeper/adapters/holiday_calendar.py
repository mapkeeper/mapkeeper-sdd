"""Official Korean holiday dates, read from a published table rather than guessed.

"추석 연휴에 문 닫아요" is one of the most ordinary things an owner says, and it is
a date only a calendar can answer: 설날 and 추석 are lunar, so no rule derives them
and a model with no calendar can only invent them. Inventing one here is not a
small error — it becomes a closure published to three public maps once approved.

So the dates are data, not arithmetic. The table ships with the service, names its
source and the years it covers, and a lookup outside that range says it does not
know. Nothing is fetched at request time, and a table that cannot be read leaves
the service with no holiday knowledge instead of a failure to start: every sentence
naming one then falls back to the date clarification UC1 already returns.

`data-model.md` §8 defines a stored `CalendarEvent` with source tracking for the
same job. That entity is still `Planned`; :class:`CalendarEvent` here is the same
shape in the same order, so the seam this module publishes is what a database-backed
provider would implement without touching the parser.
"""

from dataclasses import dataclass
from datetime import date
from functools import lru_cache
from importlib import resources
from typing import ClassVar, Final, final

from pydantic import BaseModel, ConfigDict, ValidationError
from pydantic.alias_generators import to_camel

from mapkeeper.core.logging import get_logger

logger = get_logger(__name__)

HOLIDAY_DATA_PACKAGE: Final = "mapkeeper.adapters"
HOLIDAY_DATA_FILE: Final = "korean_holidays.json"


@final
@dataclass(frozen=True, slots=True)
class CalendarEvent:
    """One published occurrence of an official holiday.

    Attributes:
        title: The holiday's name, as an owner says it ("추석").
        start_date: First day of the observed period, substitute days included.
        end_date: Last day of the observed period, inclusive.
        observance_date: The holiday itself, which is a different closure from the
            period around it — "추석 당일" and "추석 연휴" are not the same request.
        source_url: Where the dates were published, so a proposal built from them
            can be traced back.
        note: Why this period is shaped the way it is, usually a 대체공휴일.
    """

    title: str
    start_date: date
    end_date: date
    observance_date: date
    source_url: str
    note: str = ""


class _HolidayRow(BaseModel):
    """One row of the bundled table, before it is checked for consistency."""

    model_config: ClassVar[ConfigDict] = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )

    title: str
    start_date: date
    end_date: date
    observance_date: date
    note: str = ""


class _HolidayTable(BaseModel):
    """The bundled table as published, including where it came from."""

    model_config: ClassVar[ConfigDict] = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
    )

    source: str
    source_url: str
    retrieved_at: date
    covered_years: tuple[int, ...]
    notes: tuple[str, ...] = ()
    events: tuple[_HolidayRow, ...] = ()


@final
@dataclass(frozen=True, slots=True)
class BundledHolidayCalendar:
    """Answer holiday lookups from the table shipped with the service."""

    events: tuple[CalendarEvent, ...]

    def occurrence(self, title: str, on_or_after: date) -> CalendarEvent | None:
        """Return the next occurrence of one holiday, or None when unknown.

        Args:
            title: The holiday's name as the table publishes it.
            on_or_after: The reference date, in Asia/Seoul terms.

        Returns:
            The first occurrence that has not finished yet — a period already
            under way still counts, since an owner inside it says "이번 추석" about
            the one they are in. None when the table does not cover that year,
            which is the answer that keeps an extrapolated lunar date out of a
            proposal.
        """
        return next(
            (
                event
                for event in self.events
                if event.title == title and event.end_date >= on_or_after
            ),
            None,
        )


def parse_holiday_table(raw: str) -> tuple[CalendarEvent, ...]:
    """Read the published table, or return nothing when it cannot be trusted.

    A malformed table is not worth failing over: the service still answers every
    sentence that does not name a holiday, and the ones that do fall back to the
    existing date clarification instead of getting an invented range.

    Args:
        raw: The table's JSON text.

    Returns:
        Every event it publishes, ordered by the day each period opens on. Empty
        when the text is not a readable table or contradicts itself.
    """
    try:
        # Unreadable JSON and a readable table with the wrong shape are the same
        # outcome here, and pydantic reports both as this one error.
        table = _HolidayTable.model_validate_json(raw)
    except ValidationError:
        logger.warning("the bundled holiday table was not a readable table")
        return ()

    events: list[CalendarEvent] = []
    for row in table.events:
        # A row whose day falls outside its own period would resolve "당일" and
        # "연휴" to dates that disagree, so it is dropped rather than published.
        if not row.start_date <= row.observance_date <= row.end_date:
            logger.warning("a holiday row was dropped: its day is outside its own period")
            continue
        events.append(
            CalendarEvent(
                title=row.title,
                start_date=row.start_date,
                end_date=row.end_date,
                observance_date=row.observance_date,
                source_url=table.source_url,
                note=row.note,
            )
        )
    return tuple(sorted(events, key=lambda event: event.start_date))


def load_bundled_calendar(
    package: str = HOLIDAY_DATA_PACKAGE,
    resource: str = HOLIDAY_DATA_FILE,
) -> BundledHolidayCalendar:
    """Load the table that ships with the service, degrading to no knowledge."""
    try:
        raw = resources.files(package).joinpath(resource).read_text(encoding="utf-8")
    except (OSError, ModuleNotFoundError):
        logger.warning("the bundled holiday table could not be opened")
        return BundledHolidayCalendar(events=())
    return BundledHolidayCalendar(events=parse_holiday_table(raw))


@lru_cache(maxsize=1)
def get_holiday_calendar() -> BundledHolidayCalendar:
    """Return the process-wide holiday calendar, read once at first use.

    This is the seam a stored `CalendarEvent` provider replaces later: callers
    only ever ask it for one occurrence of one holiday.
    """
    return load_bundled_calendar()


__all__ = [
    "BundledHolidayCalendar",
    "CalendarEvent",
    "get_holiday_calendar",
    "load_bundled_calendar",
    "parse_holiday_table",
]
