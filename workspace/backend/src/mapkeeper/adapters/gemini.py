"""Protocol and deterministic Gemini substitute for UC1 structured changes."""

import re
from datetime import date
from typing import Final, Protocol

from mapkeeper.adapters.gemini_proposal import (
    DeterministicFirstGenerator,
    GeminiProposalStructurer,
    UnsupportedChangeError,
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
from mapkeeper.models import StoreProfile

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
TIME_PAIR: Final = 2
# What separates the two ends of a stated day: "10시부터 23시까지",
# "11시에서 21시로", "10시~21시". These shapes put the opening time first by
# themselves, with no word needed to say so.
_HOURS_SPAN_SEPARATOR: Final = re.compile(r"^\s*(?:부터|에서|~|-)\s*$")
_OPENING_WORDS: Final = re.compile(r"(?:문\s*을?\s*)?(?:열|오픈|시작)")
# "오전 10시에 열고 밤 11시에 닫아요" labels each end in the words that follow it,
# which states the day just as plainly as "10시부터 23시까지" does. Reading only the
# bare-separator shape left an owner with no way to say a whole business day the
# ordinary way: the sentence came back as a 422 with nothing to correct.
_CLOSING_WORDS: Final = re.compile(r"닫|마감|종료|폐점|까지")
_MENU_PREFIX: Final = re.compile(r"^.*?대표\s*메뉴(?:를|은|는)?\s*")
_PARKING_PREFIX: Final = re.compile(r"^.*?주차\s*(?:정보|공간|장)?(?:를|을|은|는)?\s*")
# Where a stated value ends: "김치찌개로 바꿔줘" names 김치찌개 and then asks for the
# change. Anchoring this to the end of the sentence meant anything said afterwards
# stayed part of the value - "대표 메뉴를 김치찌개로 바꾸고 주차는 불가능합니다" became
# a menu named "김치찌개로 바꾸고 주차는 불가능합니다", on its way to three public maps.
_VALUE_END: Final = re.compile(r"\s*(?:로|으로)\s*(?:바꿔|바꾸|변경|수정|해\s*줘)")
# The keyword strip left a particle behind instead of a value: "주차 공간이
# 없어졌어요" has no parking text in it, only "이 없어졌어요".
_STRANDED_PARTICLE: Final = re.compile(r"^[이가은는을를도만]\s")
# The sentence carries on into a second statement this reader cannot split.
# "매장 앞 3대 가능하고 배달도 시작했어요" says two things; keeping both as the
# parking text publishes a sentence the owner never wrote as parking information.
_SECOND_CLAUSE: Final = re.compile(r"(?:하고|이고|되고|지만|는데|은데)\s")


class GeminiProposalGenerator(Protocol):
    """Boundary for a model that turns masked text into structured changes."""

    async def generate(self, masked_text: str, profile: StoreProfile) -> tuple[ProposalChange, ...]:
        """Generate schema-valid changes from already masked text."""
        ...


def invalid_change_error() -> UnsupportedChangeError:
    """Build the domain error the stub raises when it cannot read a sentence.

    This is the same refusal the real structurer raises, and it has to stay the
    same *type*: the parser-first generator keeps its own partial reading only
    when the fallback declines with an ``UnsupportedChangeError``. Raising a bare
    ``MapKeeperError`` here slipped past that handler, so offline a sentence the
    parser had already read correctly came back as a 422 instead of a proposal.
    """
    return UnsupportedChangeError(INVALID_CHANGE_MESSAGE)


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
        # An owner stating a whole business day rarely says the word "영업시간"
        # first: "오전 10시에 열고 밤 11시에 닫아요" is the ordinary way to say it, and
        # the branch above never saw it. Only a sentence that labels both ends
        # itself reaches the reader; it refuses anything it cannot assign.
        if _states_labelled_business_day(masked_text):
            return (self._business_hours_change(masked_text, profile),)
        raise invalid_change_error()

    def _business_hours_change(
        self, masked_text: str, profile: StoreProfile
    ) -> BusinessHoursChange:
        matches = list(_TIME_PATTERN.finditer(masked_text))
        if not matches:
            raise invalid_change_error()
        current = BusinessHoursValue.model_validate(profile.business_hours)
        if len(matches) > 1:
            return BusinessHoursChange(
                field="businessHours",
                current_value=current,
                proposed_value=self._spoken_span(masked_text, matches),
            )
        spoken = _to_hour_minute(matches[0])
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

    def _spoken_span(self, masked_text: str, matches: list[re.Match[str]]) -> BusinessHoursValue:
        """Read both ends of a stated business day, or refuse to read either.

        "10시부터 23시까지" states the opening time first and the closing time
        second. Reading only the first match and keeping the stored opening time
        turned that into "opens 09:00, closes 10:00" — a day the owner never
        said, inverted, and on its way to three public maps once approved.

        "오전 10시에 열고 밤 11시에 닫아요" says the same thing with words instead of a
        separator, so the sentence itself names which end is which. Anything that
        neither separates the two ends nor labels them is still left unread.

        Raises:
            UnsupportedChangeError: the sentence names clock times this cannot
                assign to a side of the day.
        """
        if len(matches) != TIME_PAIR:
            raise invalid_change_error()
        opening, closing = matches
        separator = masked_text[opening.end() : closing.start()]
        if _HOURS_SPAN_SEPARATOR.match(separator) is None and not _states_labelled_business_day(
            masked_text
        ):
            raise invalid_change_error()
        opens = _to_hour_minute(opening)
        closes = _to_hour_minute(closing)
        if opens == closes:
            raise invalid_change_error()
        return BusinessHoursValue(open=opens, close=closes)

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
        proposed = _stated_value(_MENU_PREFIX.sub("", masked_text))
        if proposed in {"메뉴", "대표"}:
            raise invalid_change_error()
        return RepresentativeMenuNameChange(
            field="representativeMenuName",
            current_value=profile.representative_menu_name,
            proposed_value=proposed,
        )

    def _parking_info_change(self, masked_text: str, profile: StoreProfile) -> ParkingInfoChange:
        proposed = _stated_value(_PARKING_PREFIX.sub("", masked_text))
        if proposed in {"주차", "정보", "공간", "장"}:
            raise invalid_change_error()
        return ParkingInfoChange(
            field="parkingInfo",
            current_value=profile.parking_info,
            proposed_value=proposed,
        )


def _states_labelled_business_day(masked_text: str) -> bool:
    """Report whether the sentence names both ends of a day and says which is which.

    "오전 10시에 열고 밤 11시에 닫아요" puts an opening word after the first clock time
    and a closing word after the second, so the sentence itself assigns each end.
    Two clock times without those words - "오후 3시부터 5시까지 브레이크타임" - say
    nothing about opening or closing and stay unread.
    """
    matches = list(_TIME_PATTERN.finditer(masked_text))
    if len(matches) != TIME_PAIR:
        return False
    opening, closing = matches
    return (
        _OPENING_WORDS.search(masked_text[opening.end() : closing.start()]) is not None
        and _CLOSING_WORDS.search(masked_text[closing.end() :]) is not None
    )


def _stated_value(remainder: str) -> str:
    """Return the free-text value the sentence stated, or refuse to read one.

    What follows the field keyword is only the value while the sentence is still
    talking about it. Everything here is the same rule the deterministic parser
    already applies: read what was plainly said, and decline the rest rather than
    keep it. A wrong value read here is approved as a menu name or parking notice
    and published to three public maps.

    Args:
        remainder: The sentence with its field keyword and any particle removed.

    Returns:
        The stated value, stripped.

    Raises:
        UnsupportedChangeError: The sentence named no value, or carried on into a
            second statement this cannot split.
    """
    value_end = _VALUE_END.search(remainder)
    value = (remainder[: value_end.start()] if value_end else remainder).strip()
    if not value:
        raise invalid_change_error()
    if _STRANDED_PARTICLE.match(value) is not None:
        raise invalid_change_error()
    if _SECOND_CLAUSE.search(value) is not None:
        raise invalid_change_error()
    return value


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
