"""Protocol and deterministic Gemini substitute for UC1 structured changes."""

import re
from datetime import date
from typing import Final, Protocol

from mapkeeper.api.schemas.store_change import (
    BusinessHoursChange,
    BusinessHoursValue,
    ProposalChange,
    RepresentativeMenuNameChange,
    TemporaryClosureChange,
    TemporaryClosureValue,
)
from mapkeeper.core.errors import MapKeeperError
from mapkeeper.models import StoreProfile
from mapkeeper.models.enums import ApiErrorCode

INVALID_CHANGE_MESSAGE: Final = "지원하지 않는 변경 내용이거나 해석할 수 없는 값입니다."
DATE_COUNT: Final = 2
MAX_MINUTE: Final = 59
MAX_12_HOUR_CLOCK: Final = 12
MAX_24_HOUR_CLOCK: Final = 23
_TIME_PATTERN: Final = re.compile(r"(?:(오전|오후)\s*)?(\d{1,2})(?:시(?:(\d{1,2})분?)?|:(\d{2}))")
_DATE_PATTERN: Final = re.compile(r"(\d{4}-\d{2}-\d{2})")
_MENU_PREFIX: Final = re.compile(r"^.*?대표\s*메뉴(?:를|은|는)?\s*")
_MENU_SUFFIX: Final = re.compile(r"\s*(?:로|으로)?\s*(?:바꿔줘|변경해줘|변경해|바꿔|변경)\s*$")


class GeminiProposalGenerator(Protocol):
    """Boundary for a model that turns masked text into structured changes."""

    async def generate(self, masked_text: str, profile: StoreProfile) -> tuple[ProposalChange, ...]:
        """Generate schema-valid changes from already masked text."""
        ...


def invalid_change_error() -> MapKeeperError:
    """Build the existing domain error shape for invalid Gemini structure."""
    error = MapKeeperError(INVALID_CHANGE_MESSAGE)
    error.http_status = 422
    error.code = ApiErrorCode.VALIDATION_ERROR
    return error


class DeterministicGeminiStub:
    """Offline substitute used until a real Gemini key and client are provided."""

    def __init__(self) -> None:
        """Initialize the last request marker used by the safety test."""
        self.last_input: str = ""

    async def generate(self, masked_text: str, profile: StoreProfile) -> tuple[ProposalChange, ...]:
        """Parse the small UC1 vocabulary and return validated Pydantic changes."""
        self.last_input = masked_text
        lowered = masked_text.lower()
        if "영업시간" in lowered or "영업 시간" in lowered:
            match = _TIME_PATTERN.search(masked_text)
            if match is None:
                raise invalid_change_error()
            close = _to_hour_minute(match)
            current = BusinessHoursValue.model_validate(profile.business_hours)
            return (
                BusinessHoursChange(
                    field="businessHours",
                    current_value=current,
                    proposed_value=BusinessHoursValue(open=current.open, close=close),
                ),
            )
        if "휴무" in lowered or "휴일" in lowered:
            dates = [match.group(1) for match in _DATE_PATTERN.finditer(masked_text)]
            if len(dates) != DATE_COUNT:
                raise invalid_change_error()
            try:
                start, end = (date.fromisoformat(value) for value in dates)
            except ValueError as exc:
                raise invalid_change_error() from exc
            current = None
            if (
                profile.temporary_closure_start_date is not None
                and profile.temporary_closure_end_date is not None
            ):
                current = TemporaryClosureValue(
                    start_date=profile.temporary_closure_start_date,
                    end_date=profile.temporary_closure_end_date,
                )
            return (
                TemporaryClosureChange(
                    field="temporaryClosure",
                    current_value=current,
                    proposed_value=TemporaryClosureValue(start_date=start, end_date=end),
                ),
            )
        if "대표 메뉴" in masked_text or "대표메뉴" in masked_text:
            proposed = _MENU_SUFFIX.sub("", _MENU_PREFIX.sub("", masked_text)).strip()
            if not proposed or proposed in {"메뉴", "대표"}:
                raise invalid_change_error()
            current = profile.representative_menu_name
            return (
                RepresentativeMenuNameChange(
                    field="representativeMenuName",
                    current_value=current,
                    proposed_value=proposed,
                ),
            )
        raise invalid_change_error()


def _to_hour_minute(match: re.Match[str]) -> str:
    """Convert a Korean or numeric clock match into strict HH:mm."""
    meridiem, hour_text, minute_text, colon_minute = match.groups()
    hour = int(hour_text)
    minute = int(minute_text or colon_minute or "0")
    if minute > MAX_MINUTE or (hour > MAX_12_HOUR_CLOCK if meridiem else hour > MAX_24_HOUR_CLOCK):
        raise invalid_change_error()
    if meridiem == "오후" and hour < MAX_12_HOUR_CLOCK:
        hour += 12
    if meridiem == "오전" and hour == MAX_12_HOUR_CLOCK:
        hour = 0
    return f"{hour:02d}:{minute:02d}"


def get_gemini_generator() -> GeminiProposalGenerator:
    """Return the offline substitute; a future HTTP client plugs in here."""
    return DeterministicGeminiStub()
