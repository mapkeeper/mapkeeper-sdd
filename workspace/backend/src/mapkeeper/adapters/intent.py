"""Deterministic intent parsing that runs before any model call.

Most UC1 sentences are ordinary: a menu rename, a closing time, a dated closure.
Sending those to a model costs a round trip the user waits through, and a timeout
there turns a trivial edit into a failed request. This module answers the clear
cases locally and returns ``None`` for everything else, so the model is reached
only for sentences that genuinely need reading.

Declining is always safe: an unparsed sentence falls through to the model, and a
wrong guess would become a proposal the user has to notice. Every branch here
prefers ``None`` over a value the sentence did not clearly state.
"""

import re
from datetime import date, datetime, timedelta
from typing import Final
from zoneinfo import ZoneInfo

from pydantic import ValidationError

from mapkeeper.api.schemas.store_change import (
    MENU_NAME_MAX_LENGTH,
    PARKING_INFO_MAX_LENGTH,
    BusinessHoursChange,
    BusinessHoursValue,
    ParkingInfoChange,
    ProposalChange,
    RepresentativeMenuNameChange,
    TemporaryClosureChange,
    TemporaryClosureValue,
)
from mapkeeper.models import StoreProfile

MAX_MINUTE: Final = 59
NOON: Final = 12
DATE_PAIR: Final = 2

# "메뉴를 고기 만두로 바꿔줘" — the name keeps its internal spaces.
_MENU_KEYWORD: Final = r"(?:대표\s*메뉴\s*명?|주력\s*메뉴|메뉴)\s*(?:를|을|은|는)?\s*"
_MENU_VERB: Final = r"(?:바꿔\s*줘|바꿔|변경해\s*줘|변경해|변경|수정해\s*줘|수정|해\s*줘)\s*$"
_MENU_PATTERN: Final = re.compile(_MENU_KEYWORD + r"(?P<name>.+?)\s*(?:로|으로)\s*" + _MENU_VERB)
_MENU_CONNECTOR_PATTERN: Final = re.compile(r"\s*(?:와|과|및|그리고)\s*")
_COMPOUND_MENU_SUFFIXES: Final = ("세트", "정식", "모둠", "모듬", "플래터")
# "주차 정보를 매장 앞 3대 가능으로 바꿔줘" — same free-text shape as a menu rename.
_PARKING_KEYWORD: Final = r"주차\s*(?:정보|공간|장)?\s*(?:를|을|은|는)?\s*"
_PARKING_PATTERN: Final = re.compile(
    _PARKING_KEYWORD + r"(?P<info>.+?)\s*(?:로|으로)\s*" + _MENU_VERB
)
_MERIDIEM_GROUP: Final = r"(?P<meridiem>새벽|아침|오전|점심|오후|저녁|밤)?\s*"
_CLOCK_GROUP: Final = r"(?P<hour>\d{1,2})\s*시(?:\s*(?P<minute>\d{1,2})\s*분)?"
_TIME_PATTERN: Final = re.compile(_MERIDIEM_GROUP + _CLOCK_GROUP)
# "10시부터 9시까지" states both ends of a span. The readers below take a single
# value each, so a sentence shaped like this has to reach the model instead.
_SPAN_PATTERN: Final = re.compile(r"부터.*까지", re.DOTALL)
TIME_PAIR: Final = 2
_ISO_DATE_PATTERN: Final = re.compile(r"\d{4}-\d{2}-\d{2}")
_KOREAN_DATE_PATTERN: Final = re.compile(
    r"(?:(?P<year>\d{4})\s*년\s*)?(?P<month>\d{1,2})\s*월\s*(?P<day>\d{1,2})\s*일"
)
_DURATION_PATTERN: Final = re.compile(
    r"(?:(?P<numeric>\d{1,2})\s*일(?:간|동안)?|(?P<word>하루|이틀|사흘|나흘|닷새|엿새|일주일))"
)
_DURATION_WORDS: Final = {
    "하루": 1,
    "이틀": 2,
    "사흘": 3,
    "나흘": 4,
    "닷새": 5,
    "엿새": 6,
    "일주일": 7,
}
_NEXT_WEEKDAY_PATTERN: Final = re.compile(r"다음\s*주\s*(?P<weekday>[월화수목금토일])요일?")

_HOURS_CONTEXT: Final = re.compile(r"영업|문\s*을?|마감|오픈|open|close|열|닫|시작|종료|폐점|개점")
_OPENING_WORDS: Final = re.compile(r"열|오픈|시작|개점")
_CLOSING_WORDS: Final = re.compile(r"닫|마감|종료|폐점|까지")
_CLOSURE_WORDS: Final = re.compile(r"휴무|휴일|쉬|쉴|문\s*(?:을\s*)?닫|마감")
_SEOUL_TIMEZONE: Final = ZoneInfo("Asia/Seoul")
_WEEKDAY_INDEX: Final = {"월": 0, "화": 1, "수": 2, "목": 3, "금": 4, "토": 5, "일": 6}

# Hours that read as the second half of the day when spoken with these words.
_AFTERNOON_MERIDIEMS: Final = frozenset({"오후", "저녁", "밤"})
_MORNING_MERIDIEMS: Final = frozenset({"새벽", "아침", "오전"})


def _to_24_hour(
    meridiem: str | None, hour: int, minute: int, *, is_closing: bool = False
) -> str | None:
    """Convert a Korean clock expression to ``HH:mm``, or None if it cannot be.

    Returns:
        The time in 24-hour form, or None when the sentence names an hour that
        does not exist.
    """
    if minute > MAX_MINUTE:
        return None
    if meridiem in _AFTERNOON_MERIDIEMS:
        if hour > NOON:
            return None
        # "밤 12시" is always midnight. "오후 12시" is midnight too, but only
        # when it names a closing time: shop owners commonly say "오후 12시"
        # to mean the same thing as "밤 12시" there ("마감 시간을 오후 12시로
        # 늘려줘" means extend to midnight, not close 3 hours after opening).
        # Naming an opening time keeps the grammatical reading, since "오후
        # 12시에 열어요" unambiguously means noon.
        is_midnight = hour == NOON and (meridiem == "밤" or (meridiem == "오후" and is_closing))
        resolved = 0 if is_midnight else hour % NOON + NOON
    elif meridiem in _MORNING_MERIDIEMS:
        if hour > NOON:
            return None
        resolved = 0 if hour == NOON else hour
    elif meridiem == "점심":
        if hour > NOON:
            return None
        resolved = hour if hour == NOON else hour + NOON
    else:
        if hour > NOON * 2 - 1:
            return None
        resolved = hour
    return f"{resolved:02d}:{minute:02d}"


def _parse_menu(text: str, profile: StoreProfile) -> ProposalChange | None:
    """Read a representative-menu rename, or None when the sentence is not one."""
    match = _MENU_PATTERN.search(text)
    if match is None:
        return None
    name = match.group("name").strip()
    if not name or len(name) > MENU_NAME_MAX_LENGTH:
        return None
    if is_multiple_menu_request(text):
        return None
    # A bare keyword is not a name the owner actually said.
    if name in {"메뉴", "대표", "이름", "명"}:
        return None
    return RepresentativeMenuNameChange(
        field="representativeMenuName",
        current_value=profile.representative_menu_name,
        proposed_value=name,
    )


def is_multiple_menu_request(text: str) -> bool:
    """Return whether a menu change names multiple independent menu items."""
    match = _MENU_PATTERN.search(text)
    if match is None:
        return False
    name = match.group("name").strip()
    if name.endswith(_COMPOUND_MENU_SUFFIXES):
        return False
    parts = _MENU_CONNECTOR_PATTERN.split(name)
    return len(parts) > 1 and all(part and " " not in part for part in parts)


def _parse_parking_info(text: str, profile: StoreProfile) -> ProposalChange | None:
    """Read a parking-info update, or None when the sentence is not one."""
    match = _PARKING_PATTERN.search(text)
    if match is None:
        return None
    info = match.group("info").strip()
    if not info or len(info) > PARKING_INFO_MAX_LENGTH:
        return None
    # A bare keyword is not a value the owner actually said.
    if info in {"주차", "정보", "공간", "장"}:
        return None
    return ParkingInfoChange(
        field="parkingInfo",
        current_value=profile.parking_info,
        proposed_value=info,
    )


def _parse_business_hours(text: str, profile: StoreProfile) -> ProposalChange | None:
    """Read an opening or closing time, or None when the sentence is not one."""
    if _HOURS_CONTEXT.search(text) is None:
        return None
    # Both ends of the day were spoken, but only one is read below. Guessing here
    # would take the opening time for the closing one and invert the day.
    if len(_TIME_PATTERN.findall(text)) >= TIME_PAIR:
        return None
    match = _TIME_PATTERN.search(text)
    if match is None:
        return None

    # Which side of the day was spoken about. Saying nothing means closing time,
    # which is what "몇 시까지" asks; an explicit closing word wins over an
    # incidental "열" inside a word like "열심히".
    opens = _OPENING_WORDS.search(text) is not None and _CLOSING_WORDS.search(text) is None
    spoken = _to_24_hour(
        match.group("meridiem"),
        int(match.group("hour")),
        int(match.group("minute") or 0),
        is_closing=not opens,
    )
    if spoken is None:
        return None

    try:
        current = BusinessHoursValue.model_validate(profile.business_hours)
    except ValidationError:
        return None

    proposed = (
        BusinessHoursValue(open=spoken, close=current.close)
        if opens
        else BusinessHoursValue(open=current.open, close=spoken)
    )
    return BusinessHoursChange(
        field="businessHours",
        current_value=current,
        proposed_value=proposed,
    )


def _resolve_relative_dates(text: str, today: date) -> tuple[date, date] | None:
    weekday_match = _NEXT_WEEKDAY_PATTERN.search(text)
    if weekday_match is not None:
        next_monday = today - timedelta(days=today.weekday()) + timedelta(days=7)
        resolved = next_monday + timedelta(days=_WEEKDAY_INDEX[weekday_match.group("weekday")])
        return resolved, resolved

    if re.search(r"다음\s*주", text) is not None:
        next_monday = today - timedelta(days=today.weekday()) + timedelta(days=7)
        return next_monday, next_monday + timedelta(days=6)

    if re.search(r"이번\s*주", text) is not None:
        monday = today - timedelta(days=today.weekday())
        return monday, monday + timedelta(days=6)

    for keyword, offset in (("오늘", 0), ("내일", 1), ("모레", 2)):
        if keyword in text:
            resolved = today + timedelta(days=offset)
            return resolved, resolved
    return None


def _resolve_duration_dates(text: str, today: date) -> tuple[date, date] | None:
    duration_match = _DURATION_PATTERN.search(text)
    if duration_match is None:
        return _resolve_relative_dates(text, today)
    relative_dates = _resolve_relative_dates(text, today)
    if relative_dates is None:
        return None
    days = (
        int(duration_match.group("numeric"))
        if duration_match.group("numeric") is not None
        else _DURATION_WORDS[duration_match.group("word")]
    )
    if days < 1:
        return None
    start, _ = relative_dates
    return start, start + timedelta(days=days - 1)


def _parse_korean_dates(text: str, today: date) -> tuple[date, date] | None:
    matches = list(_KOREAN_DATE_PATTERN.finditer(text))
    if not matches or len(matches) > DATE_PAIR:
        return None
    dates: list[date] = []
    for match in matches:
        year = int(match.group("year") or today.year)
        month = int(match.group("month"))
        day = int(match.group("day"))
        try:
            dates.append(date(year, month, day))
        except ValueError:
            return None
    if len(dates) == 1:
        return dates[0], dates[0]
    return dates[0], dates[1]


def _states_unreadable_span(text: str) -> bool:
    """Report a stated date range whose two ends cannot both be read here.

    "8월 25일부터 26일까지" names two days, but the Korean date pattern needs a
    month beside each one and so sees only the first. Reading that would close the
    store for a single day when the owner asked for two.
    """
    if _SPAN_PATTERN.search(text) is None:
        return False
    return (
        len(_ISO_DATE_PATTERN.findall(text)) != DATE_PAIR
        and len(_KOREAN_DATE_PATTERN.findall(text)) != DATE_PAIR
    )


def _parse_temporary_closure(
    text: str, profile: StoreProfile, today: date
) -> ProposalChange | None:
    if _CLOSURE_WORDS.search(text) is None or _states_unreadable_span(text):
        return None
    found = [match.group() for match in _ISO_DATE_PATTERN.finditer(text)]
    if len(found) == DATE_PAIR:
        try:
            start, end = (date.fromisoformat(value) for value in found)
        except ValueError:
            return None
    elif not found:
        resolved = _parse_korean_dates(text, today) or _resolve_duration_dates(text, today)
        if resolved is None:
            return None
        start, end = resolved
    else:
        return None
    if end < start:
        return None

    current = None
    if profile.temporary_closure_start_date and profile.temporary_closure_end_date:
        current = TemporaryClosureValue(
            start_date=profile.temporary_closure_start_date,
            end_date=profile.temporary_closure_end_date,
        )
    return TemporaryClosureChange(
        field="temporaryClosure",
        current_value=current,
        proposed_value=TemporaryClosureValue(start_date=start, end_date=end),
    )


def parse_intent(
    masked_text: str,
    profile: StoreProfile,
    today: date | None = None,
) -> tuple[ProposalChange, ...] | None:
    """Turn a clear sentence into validated changes without calling a model.

    Args:
        masked_text: The recognized sentence, already stripped of customer PII.
        profile: The store the change applies to, used for every currentValue.
        today: Reference date for relative expressions, primarily for deterministic
            tests. Defaults to the current date in the service's Seoul timezone.

    Returns:
        The changes the sentence plainly states, or None when it should be read by
        the model instead. None is never an error — it is the handoff.
    """
    text = masked_text.strip()
    if not text:
        return None

    # Menu first: "메뉴를 …로 바꿔줘" can contain a word the hours branch reacts to.
    menu = _parse_menu(text, profile)
    if menu is not None:
        return (menu,)
    parking = _parse_parking_info(text, profile)
    if parking is not None:
        return (parking,)
    closure = _parse_temporary_closure(
        text,
        profile,
        today if today is not None else datetime.now(_SEOUL_TIMEZONE).date(),
    )
    if closure is not None:
        return (closure,)
    hours = _parse_business_hours(text, profile)
    if hours is not None:
        return (hours,)
    return None


__all__ = ["parse_intent"]
