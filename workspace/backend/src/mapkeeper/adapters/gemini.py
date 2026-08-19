"""Protocol and deterministic Gemini substitute for UC1 structured changes."""

import re
from datetime import date
from typing import Final, Protocol

from mapkeeper.adapters.gemini_proposal import (
    DeterministicFirstGenerator,
    GeminiProposalStructurer,
)
from mapkeeper.adapters.gemini_seo import HttpGeminiModelClient
from mapkeeper.api.schemas.store_change import (
    BusinessHoursChange,
    BusinessHoursValue,
    ParkingInfoChange,
    ProposalChange,
    RepresentativeMenuNameChange,
    TemporaryClosureChange,
    TemporaryClosureValue,
)
from mapkeeper.core.config import get_settings
from mapkeeper.core.errors import MapKeeperError
from mapkeeper.models import StoreProfile
from mapkeeper.models.enums import ApiErrorCode

INVALID_CHANGE_MESSAGE: Final = "지원하지 않는 변경 내용이거나 해석할 수 없는 값입니다."
DATE_COUNT: Final = 2
MAX_MINUTE: Final = 59
MAX_12_HOUR_CLOCK: Final = 12
MAX_24_HOUR_CLOCK: Final = 23
_AFTERNOON_MERIDIEMS: Final = frozenset({"오후", "저녁", "밤"})
_MORNING_MERIDIEMS: Final = frozenset({"새벽", "아침", "오전"})
_TIME_PATTERN: Final = re.compile(
    r"(?:(새벽|아침|오전|점심|오후|저녁|밤)\s*)?(\d{1,2})(?:시(?:(\d{1,2})분?)?|:(\d{2}))"
)
_DATE_PATTERN: Final = re.compile(r"(\d{4}-\d{2}-\d{2})")
_OPENING_WORDS: Final = re.compile(r"(?:문\s*을?\s*)?(?:열|오픈|시작)")
_MENU_PREFIX: Final = re.compile(r"^.*?대표\s*메뉴(?:를|은|는)?\s*")
_MENU_SUFFIX: Final = re.compile(r"\s*(?:로|으로)?\s*(?:바꿔줘|변경해줘|변경해|바꿔|변경)\s*$")
_PARKING_PREFIX: Final = re.compile(r"^.*?주차\s*(?:정보|공간|장)?(?:를|을|은|는)?\s*")


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
            return (self._business_hours_change(masked_text, profile),)
        if "휴무" in lowered or "휴일" in lowered:
            return (self._temporary_closure_change(masked_text, profile),)
        if "대표 메뉴" in masked_text or "대표메뉴" in masked_text:
            return (self._menu_name_change(masked_text, profile),)
        if "주차" in lowered:
            return (self._parking_info_change(masked_text, profile),)
        raise invalid_change_error()

    def _business_hours_change(
        self, masked_text: str, profile: StoreProfile
    ) -> BusinessHoursChange:
        match = _TIME_PATTERN.search(masked_text)
        if match is None:
            raise invalid_change_error()
        spoken = _to_hour_minute(match)
        current = BusinessHoursValue.model_validate(profile.business_hours)
        # Which side of the day was spoken about. Saying nothing means closing
        # time, which is what "몇 시까지" asks about.
        if _OPENING_WORDS.search(masked_text):
            proposed = BusinessHoursValue(open=spoken, close=current.close)
        else:
            proposed = BusinessHoursValue(open=current.open, close=spoken)
        return BusinessHoursChange(
            field="businessHours",
            current_value=current,
            proposed_value=proposed,
        )

    def _temporary_closure_change(
        self, masked_text: str, profile: StoreProfile
    ) -> TemporaryClosureChange:
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
        return TemporaryClosureChange(
            field="temporaryClosure",
            current_value=current,
            proposed_value=TemporaryClosureValue(start_date=start, end_date=end),
        )

    def _menu_name_change(
        self, masked_text: str, profile: StoreProfile
    ) -> RepresentativeMenuNameChange:
        proposed = _MENU_SUFFIX.sub("", _MENU_PREFIX.sub("", masked_text)).strip()
        if not proposed or proposed in {"메뉴", "대표"}:
            raise invalid_change_error()
        return RepresentativeMenuNameChange(
            field="representativeMenuName",
            current_value=profile.representative_menu_name,
            proposed_value=proposed,
        )

    def _parking_info_change(self, masked_text: str, profile: StoreProfile) -> ParkingInfoChange:
        proposed = _MENU_SUFFIX.sub("", _PARKING_PREFIX.sub("", masked_text)).strip()
        if not proposed or proposed in {"주차", "정보", "공간", "장"}:
            raise invalid_change_error()
        return ParkingInfoChange(
            field="parkingInfo",
            current_value=profile.parking_info,
            proposed_value=proposed,
        )


def _to_hour_minute(match: re.Match[str]) -> str:
    """Convert a Korean or numeric clock match into strict HH:mm."""
    meridiem, hour_text, minute_text, colon_minute = match.groups()
    hour = int(hour_text)
    minute = int(minute_text or colon_minute or "0")
    if minute > MAX_MINUTE or (hour > MAX_12_HOUR_CLOCK if meridiem else hour > MAX_24_HOUR_CLOCK):
        raise invalid_change_error()
    if meridiem in _AFTERNOON_MERIDIEMS:
        hour = 0 if meridiem == "밤" and hour == MAX_12_HOUR_CLOCK else hour % 12 + 12
    elif meridiem in _MORNING_MERIDIEMS:
        hour = 0 if hour == MAX_12_HOUR_CLOCK else hour
    elif meridiem == "점심":
        hour = hour if hour == MAX_12_HOUR_CLOCK else hour + 12
    return f"{hour:02d}:{minute:02d}"


def get_gemini_generator() -> GeminiProposalGenerator:
    """Return the Gemini structurer when a key is configured, otherwise the stub.

    The stub only matches four keywords and a clock regex, so anything phrased
    differently is refused. It stays as the offline fallback.
    """
    settings = get_settings()
    if settings.gemini_api_key is None:
        return DeterministicFirstGenerator(DeterministicGeminiStub())
    return DeterministicFirstGenerator(
        GeminiProposalStructurer(
            HttpGeminiModelClient(
                api_key=settings.gemini_api_key.get_secret_value(),
                model=settings.gemini_model,
                timeout_seconds=settings.gemini_timeout_seconds,
            )
        )
    )
