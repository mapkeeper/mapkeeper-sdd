"""Adapter boundaries shared across modules, kept here to avoid import cycles."""

from datetime import date
from typing import Protocol

from mapkeeper.adapters.holiday_calendar import CalendarEvent
from mapkeeper.api.schemas.store_change import ProposalChange
from mapkeeper.models import StoreProfile


class KoreanHolidayCalendar(Protocol):
    """Where official holiday dates come from.

    The bundled table answers this today. A stored `CalendarEvent` source
    (`data-model.md` §8) answers it later without the parser changing, as long as
    it keeps the same two promises: no lookup reaches the network while a request
    is in flight, and an unknown holiday is reported as unknown rather than
    extrapolated.
    """

    def occurrence(self, title: str, on_or_after: date) -> CalendarEvent | None:
        """Return the next occurrence of one holiday, or None when unknown."""
        ...


class GeminiProposalGenerator(Protocol):
    """Turn one masked sentence into validated UC1 changes."""

    async def generate(
        self,
        masked_text: str,
        profile: StoreProfile,
    ) -> tuple[ProposalChange, ...]:
        """Return the changes the sentence describes."""
        ...


__all__ = ["GeminiProposalGenerator", "KoreanHolidayCalendar"]
