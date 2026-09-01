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
from mapkeeper.models.enums import ProposalFailureReason

MAX_MINUTE: Final = 59
NOON: Final = 12
DATE_PAIR: Final = 2

# "메뉴를 고기 만두로 바꿔줘" — the name keeps its internal spaces.
_MENU_KEYWORD: Final = r"(?:대표\s*메뉴\s*명?|주력\s*메뉴|메뉴)\s*(?:를|을|은|는)?\s*"
# Anchored to the end of what is being read. A compound sentence is split into
# clauses first, so "대표 메뉴를 김치찌개로 바꾸고 주차는 불가능합니다" reaches this as
# "…김치찌개로 바꾸" — the connective stem needs to end the verb list too.
_MENU_VERB: Final = r"(?:바꿔\s*줘|바꿔|바꾸|변경해\s*줘|변경해|변경|수정해\s*줘|수정|해\s*줘)\s*$"
_MENU_PATTERN: Final = re.compile(_MENU_KEYWORD + r"(?P<name>.+?)\s*(?:로|으로)\s*" + _MENU_VERB)
_MENU_CONNECTOR_PATTERN: Final = re.compile(r"\s*(?:와|과|및|그리고)\s*")
_COMPOUND_MENU_SUFFIXES: Final = ("세트", "정식", "모둠", "모듬", "플래터")
# "주차 정보를 매장 앞 3대 가능으로 바꿔줘" — same free-text shape as a menu rename.
_PARKING_KEYWORD: Final = r"주차\s*(?:정보|공간|장)?\s*(?:를|을|은|는)?\s*"
_PARKING_PATTERN: Final = re.compile(
    _PARKING_KEYWORD + r"(?P<info>.+?)\s*(?:로|으로)\s*" + _MENU_VERB
)
# "주차는 불가능합니다" is how an owner states parking, and it names no value to
# copy: the pattern above needs "…으로 바꿔줘". Without these the second half of
# "9월 1일은 임시 휴무이고 주차는 불가능합니다" was only ever reported as dropped, so
# the owner had to say it again on its own. The two readings below are the whole
# vocabulary — a sentence that says anything more than "possible" or "not
# possible" still has to name the text it wants stored.
_PARKING_SUBJECT: Final = r"주차\s*(?:정보|공간|장)?\s*(?:는|은|가|이|도)?\s*"
_PARKING_UNAVAILABLE_PATTERN: Final = re.compile(
    _PARKING_SUBJECT
    + r"(?:불가능|불가|안\s*(?:됩니다|돼요|된다|돼|되고)|어렵습니다|없습니다|없어요)"
)
_PARKING_AVAILABLE_PATTERN: Final = re.compile(
    _PARKING_SUBJECT + r"(?:가능합니다|가능해요|가능|됩니다|돼요|된다)"
)
PARKING_UNAVAILABLE_VALUE: Final = "주차 불가"
PARKING_AVAILABLE_VALUE: Final = "주차 가능"
# Where one spoken request ends and the next begins. "고" joins two separate
# requests ("…로 바꾸고 주차는…") as readily as it joins the two ends of one stated
# business day ("10시에 열고 21시에 닫아요"), so splitting on it is only safe because
# _parse_each_clause throws the split away when two clauses answer for one field.
_CLAUSE_SPLIT_PATTERN: Final = re.compile(
    r"(?:\s*(?:그리고|이고|하고|되고|고|이며|하며)\s+|[,;\n]\s*)"
)
_MERIDIEM_GROUP: Final = r"(?P<meridiem>새벽|아침|오전|점심|오후|저녁|밤)?\s*"
_CLOCK_GROUP: Final = r"(?P<hour>\d{1,2})\s*시(?:\s*(?P<minute>\d{1,2})\s*분)?"
_TIME_PATTERN: Final = re.compile(_MERIDIEM_GROUP + _CLOCK_GROUP)
# "10시부터 9시까지" states both ends of a span. The readers below take a single
# value each, so a sentence shaped like this has to reach the model instead.
_SPAN_PATTERN: Final = re.compile(r"부터.*까지", re.DOTALL)
# "오전 10시부터 오후 9시까지" opens a span with a clock time, not a date. The
# closure reader's span guard below exists for date ranges it cannot read whole;
# firing it on a business day meant "다음 주 월요일 하루 임시 휴무이고 영업시간은
# 오전 10시부터 오후 9시까지입니다" dropped the closure and proposed the hours alone.
_CLOCK_SPAN_PATTERN: Final = re.compile(
    r"\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?\s*(?:부터|에서|~|-)",
)
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
# "다음 주 월요일부터 수요일까지" states both ends of a closure, and the ends are
# written in different shapes: the first names its week, the second is a bare
# weekday that inherits it. Reading only the first half closed the store for one
# day when the owner asked for three, so both ends are read from the sentence.
_SPAN_SPLIT_PATTERN: Final = re.compile(r"(?P<start>.+?)\s*부터\s*(?P<end>.+?)\s*까지")
# "8월 25일부터 26일까지" — the second end omits the month it shares with the first.
_BARE_DAY_PATTERN: Final = re.compile(r"^(?P<day>\d{1,2})\s*일$")
_BARE_WEEKDAY_PATTERN: Final = re.compile(r"^(?P<weekday>[월화수목금토일])\s*요일?$")
_NEXT_WEEK: Final = r"(?<!다)다음\s*주"
_NEXT_WEEKDAY_PATTERN: Final = re.compile(_NEXT_WEEK + r"\s*(?P<weekday>[월화수목금토일])요일?")
# "이번 주 금요일" names one day the same way "다음 주 금요일" does. Without this
# the sentence fell through to the bare "이번 주" branch below, which answers with
# the whole Monday-to-Sunday week — so asking to close one Friday proposed a
# seven-day closure, and "이번 주 금요일 하루만" closed the Monday instead.
_THIS_WEEKDAY_PATTERN: Final = re.compile(r"이번\s*주\s*(?P<weekday>[월화수목금토일])요일?")

_HOURS_CONTEXT: Final = re.compile(r"영업|문\s*을?|마감|오픈|open|close|열|닫|시작|종료|폐점|개점")
_OPENING_WORDS: Final = re.compile(r"열|오픈|시작|개점")
_CLOSING_WORDS: Final = re.compile(r"닫|마감|종료|폐점|까지")
# "쉽니다" is not "쉬" plus an ending — it is a different syllable, so the bare
# "쉬" below never saw the most ordinary way an owner states a closure. Every
# conjugated stem an owner actually speaks is listed instead of guessed at.
_CLOSURE_WORDS: Final = re.compile(
    r"휴무|휴업|휴일|쉬|쉽니|쉼|쉴|문\s*(?:을\s*)?닫|마감|영업\s*(?:을\s*)?안\s*(?:해|합니|하)"
)
# A time of day with no hour in it. "오후에 문을 닫습니다" names when, not what
# time, and the difference is what the owner has to be asked for.
_VAGUE_TIME_WORDS: Final = re.compile(r"오전|오후|저녁|아침|새벽|점심|밤|낮")
_CLOCK_PATTERN: Final = re.compile(r"\d{1,2}\s*시")
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


def _stated_parking_availability(text: str) -> str | None:
    """Read "주차는 불가능합니다" as the parking notice it states, or None.

    Checked in this order because "불가능" contains "가능": reading the sentence
    the other way round would publish "주차 가능" for a store that has no parking.
    """
    if _PARKING_UNAVAILABLE_PATTERN.search(text) is not None:
        return PARKING_UNAVAILABLE_VALUE
    if _PARKING_AVAILABLE_PATTERN.search(text) is not None:
        return PARKING_AVAILABLE_VALUE
    return None


def _parse_parking_info(text: str, profile: StoreProfile) -> ProposalChange | None:
    """Read a parking-info update, or None when the sentence is not one."""
    match = _PARKING_PATTERN.search(text)
    if match is None:
        stated = _stated_parking_availability(text)
        if stated is None:
            return None
        return ParkingInfoChange(
            field="parkingInfo",
            current_value=profile.parking_info,
            proposed_value=stated,
        )
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

    if re.search(_NEXT_WEEK, text) is not None:
        next_monday = today - timedelta(days=today.weekday()) + timedelta(days=7)
        return next_monday, next_monday + timedelta(days=6)

    this_weekday_match = _THIS_WEEKDAY_PATTERN.search(text)
    if this_weekday_match is not None:
        monday = today - timedelta(days=today.weekday())
        resolved = monday + timedelta(days=_WEEKDAY_INDEX[this_weekday_match.group("weekday")])
        return resolved, resolved

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


def _date_span_text(text: str) -> str:
    """Return the sentence with any clock span removed.

    "오전 10시부터 오후 9시까지" opens a span with a clock time, which states the
    business day rather than a date range. Leaving it in made the date readers
    below look at a span that was never theirs.
    """
    return _CLOCK_SPAN_PATTERN.sub(" ", text)


def _explicit_span_date(segment: str, today: date) -> tuple[date, date] | None:
    """Read a fully written date from one end of a span, or None when it has none."""
    iso = [match.group() for match in _ISO_DATE_PATTERN.finditer(segment)]
    if len(iso) == 1:
        try:
            written = date.fromisoformat(iso[0])
        except ValueError:
            return None
        return written, written
    if iso:
        return None
    return _parse_korean_dates(segment, today)


def _span_start(segment: str, today: date) -> date | None:
    """Read the day a stated range opens on."""
    explicit = _explicit_span_date(segment, today)
    if explicit is not None:
        return explicit[0]
    relative = _resolve_relative_dates(segment, today)
    return None if relative is None else relative[0]


def _shorthand_span_end(segment: str, start: date) -> date | None:
    """Read a range's far end written short, against the context the start set.

    The second end of a Korean range routinely drops what it shares with the
    first: "8월 25일부터 26일까지" drops the month and "다음 주 월요일부터 수요일까지"
    drops the week. Both are resolved against ``start`` rather than against today,
    which is what the owner meant by leaving them out.
    """
    bare_day = _BARE_DAY_PATTERN.match(segment)
    if bare_day is not None:
        try:
            return date(start.year, start.month, int(bare_day.group("day")))
        except ValueError:
            return None
    bare_weekday = _BARE_WEEKDAY_PATTERN.match(segment)
    if bare_weekday is None:
        return None
    weekday = _WEEKDAY_INDEX[bare_weekday.group("weekday")]
    return start + timedelta(days=(weekday - start.weekday()) % 7)


def _span_end(segment: str, start: date, today: date) -> date | None:
    """Read the day a stated range closes on, in the context the start set."""
    explicit = _explicit_span_date(segment, today)
    if explicit is not None:
        return explicit[1]
    shorthand = _shorthand_span_end(segment, start)
    if shorthand is not None:
        return shorthand
    relative = _resolve_relative_dates(segment, today)
    return None if relative is None else relative[1]


def _parse_date_span(text: str, today: date) -> tuple[date, date] | None:
    """Read both ends of a stated "…부터 …까지" range, or None when either is unread.

    Returning a half-read range is the one outcome this must never produce: the
    owner asked for three days off and would have been given one.
    """
    match = _SPAN_SPLIT_PATTERN.search(text)
    if match is None:
        return None
    start = _span_start(match.group("start").strip(), today)
    if start is None:
        return None
    end = _span_end(match.group("end").strip(), start, today)
    if end is None:
        return None
    return start, end


def _states_unreadable_span(text: str) -> bool:
    """Report a stated date range this module could not read whole.

    Only reached once :func:`_parse_date_span` has already declined, so a span
    still standing here is one whose ends cannot both be pinned down. Reading the
    single date it can see would close the store for one day out of several.

    Only a span between *dates* can be misread that way. A span opened by a clock
    time states the business day, which the hours reader handles, so it is taken
    out of the text before the guard looks for one.
    """
    return _SPAN_PATTERN.search(_date_span_text(text)) is not None


def _resolve_closure_dates(text: str, today: date) -> tuple[date, date] | None:
    """Turn the dates a closure sentence states into an exact inclusive range."""
    found = [match.group() for match in _ISO_DATE_PATTERN.finditer(text)]
    if len(found) == DATE_PAIR:
        try:
            start, end = (date.fromisoformat(value) for value in found)
        except ValueError:
            return None
        return start, end
    if found:
        # One ISO date beside a "부터"/"까지" leaves the other end unstated.
        return None
    span = _parse_date_span(_date_span_text(text), today)
    if span is not None:
        return span
    if _states_unreadable_span(text):
        return None
    return _parse_korean_dates(text, today) or _resolve_duration_dates(text, today)


def _parse_temporary_closure(
    text: str, profile: StoreProfile, today: date
) -> ProposalChange | None:
    if _CLOSURE_WORDS.search(text) is None:
        return None
    resolved = _resolve_closure_dates(text, today)
    if resolved is None:
        return None
    start, end = resolved
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


# Which of the four supported fields a sentence talks about, whether or not the
# readers above manage to turn that mention into a value. A sentence can name two
# fields and only be read for one; without this the second one disappeared without
# a word, which is worse than refusing the whole sentence.
_FIELD_TOPICS: Final[tuple[tuple[str, str, re.Pattern[str]], ...]] = (
    (
        "businessHours",
        "영업시간",
        # Deliberately not "문 닫는다": that is how a closure is stated, and
        # reading it as an hours request made "내일 문 닫아" report an hours
        # change it had dropped when it had done nothing of the sort.
        re.compile(r"영업\s*시간|오픈\s*시간|마감\s*시간|영업\s*시작|영업\s*종료"),
    ),
    (
        "temporaryClosure",
        "임시 휴무",
        re.compile(r"휴무|휴업|휴일|쉬|쉽니|쉼|쉴"),
    ),
    (
        "representativeMenuName",
        "대표 메뉴",
        re.compile(r"대표\s*메뉴|주력\s*메뉴|메뉴"),
    ),
    (
        "parkingInfo",
        "주차 정보",
        re.compile(r"주차"),
    ),
)


def unmapped_request_labels(
    masked_text: str,
    changes: tuple[ProposalChange, ...],
) -> tuple[str, ...]:
    """Name the fields the sentence brought up that no change ended up carrying.

    Args:
        masked_text: The sentence the owner spoke, already stripped of customer PII.
        changes: Every change the sentence did produce.

    Returns:
        Korean field labels, in the contract's field order, for each topic the
        sentence names and the changes do not cover. Empty when nothing was
        dropped.
    """
    covered = {change.field for change in changes}
    return tuple(
        label
        for field, label, pattern in _FIELD_TOPICS
        if field not in covered and pattern.search(masked_text) is not None
    )


def _parse_one_statement(
    text: str,
    profile: StoreProfile,
    today: date,
) -> ProposalChange | None:
    """Read the single field one statement names, or None when it names none."""
    # Menu first: "메뉴를 …로 바꿔줘" can contain a word the hours branch reacts to.
    menu = _parse_menu(text, profile)
    if menu is not None:
        return menu
    parking = _parse_parking_info(text, profile)
    if parking is not None:
        return parking
    closure = _parse_temporary_closure(text, profile, today)
    if closure is not None:
        return closure
    return _parse_business_hours(text, profile)


def _parse_each_clause(
    clauses: list[str],
    profile: StoreProfile,
    today: date,
) -> tuple[ProposalChange, ...] | None:
    """Read one compound sentence as the several requests it actually is.

    Returns:
        One change per field the clauses state, in the order they were spoken, or
        None when the split cannot be trusted. Two clauses answering for the same
        field mean the split cut through a single statement rather than between
        two — "10시에 시작하고 21시에 마감해" is one business day, and keeping either
        half alone would publish a day the owner never said.
    """
    by_field: dict[str, ProposalChange] = {}
    for clause in clauses:
        change = _parse_one_statement(clause, profile, today)
        if change is None:
            continue
        if change.field in by_field:
            return None
        by_field[change.field] = change
    return tuple(by_field.values()) or None


def parse_intent(
    masked_text: str,
    profile: StoreProfile,
    today: date | None = None,
) -> tuple[ProposalChange, ...] | None:
    """Turn a clear sentence into validated changes without calling a model.

    A sentence can ask for more than one thing: "9월 1일은 임시 휴무이고 주차는
    불가능합니다" is two requests joined by "이고". Reading only the first left the
    second to be reported as dropped, so the owner had to say it a second time.
    The sentence is therefore split on the connectives that end a clause outright
    and each half is read on its own; the whole-sentence reading is kept whenever
    the split does not turn up more than it did.

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
    reference = today if today is not None else datetime.now(_SEOUL_TIMEZONE).date()

    whole = _parse_one_statement(text, profile, reference)
    clauses = [clause.strip() for clause in _CLAUSE_SPLIT_PATTERN.split(text) if clause.strip()]
    if len(clauses) > 1:
        split = _parse_each_clause(clauses, profile, reference)
        if split is not None and len(split) > (1 if whole is not None else 0):
            return split
    return None if whole is None else (whole,)


def _names_an_impossible_date(text: str) -> bool:
    """Report a date the owner stated that no calendar has, such as 2월 30일."""
    for match in _KOREAN_DATE_PATTERN.finditer(text):
        try:
            _ = date(
                int(match.group("year") or date.today().year),  # noqa: DTZ011
                int(match.group("month")),
                int(match.group("day")),
            )
        except ValueError:
            return True
    for iso in _ISO_DATE_PATTERN.finditer(text):
        try:
            _ = date.fromisoformat(iso.group())
        except ValueError:
            return True
    return False


def classify_failure_reason(
    masked_text: str,
    today: date | None = None,
) -> ProposalFailureReason:
    """Name why this sentence produced no change, in terms the screen can act on.

    A refusal that only says "다시 확인해 주세요" leaves the owner guessing which
    part of what they said was the problem. Each reason here maps to a different
    thing they have to change — a clock time, a date, one menu name, a supported
    field — so the screen can ask for exactly that and put their sentence back in
    the box.

    Args:
        masked_text: The sentence that was refused, already stripped of PII.
        today: Reference date for relative expressions. Defaults to today in Seoul.

    Returns:
        The most specific reason the sentence supports.
    """
    text = masked_text.strip()
    reference = today if today is not None else datetime.now(_SEOUL_TIMEZONE).date()
    if is_multiple_menu_request(text):
        return ProposalFailureReason.MULTIPLE_MENU_CANDIDATES

    topics = {field for field, _, pattern in _FIELD_TOPICS if pattern.search(text) is not None}
    states_closure = _CLOSURE_WORDS.search(text) is not None
    states_hours = "businessHours" in topics or _HOURS_CONTEXT.search(text) is not None

    if states_closure or "temporaryClosure" in topics:
        reason = _closure_failure_reason(text, reference, states_hours=states_hours)
        if reason is not None:
            return reason
    if states_hours:
        return ProposalFailureReason.AMBIGUOUS_TIME
    if not topics:
        return ProposalFailureReason.UNSUPPORTED_FIELD
    return ProposalFailureReason.NO_CHANGE_FOUND


def _closure_failure_reason(
    text: str,
    reference: date,
    *,
    states_hours: bool,
) -> ProposalFailureReason | None:
    """Name what a closure sentence got wrong, or None when nothing did."""
    if _names_an_impossible_date(text):
        return ProposalFailureReason.INVALID_DATE
    resolved = _resolve_closure_dates(text, reference)
    if resolved is None:
        if _states_unreadable_span(text):
            return ProposalFailureReason.UNREADABLE_DATE_RANGE
        # "오후에 문을 닫습니다" states a time of day and no clock time. It reads as a
        # closure only because "문 닫" does; what is missing is the hour.
        if (
            states_hours
            and _CLOCK_PATTERN.search(text) is None
            and _VAGUE_TIME_WORDS.search(text) is not None
        ):
            return ProposalFailureReason.AMBIGUOUS_TIME
        return ProposalFailureReason.AMBIGUOUS_DATE
    start, end = resolved
    if end < start:
        return ProposalFailureReason.INVALID_DATE
    return None


__all__ = ["classify_failure_reason", "parse_intent", "unmapped_request_labels"]
