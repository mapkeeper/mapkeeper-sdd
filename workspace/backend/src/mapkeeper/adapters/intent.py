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
from datetime import date
from typing import Final

from pydantic import ValidationError

from mapkeeper.api.schemas.store_change import (
    MENU_NAME_MAX_LENGTH,
    BusinessHoursChange,
    BusinessHoursValue,
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
_MERIDIEM_GROUP: Final = r"(?P<meridiem>새벽|아침|오전|점심|오후|저녁|밤)?\s*"
_CLOCK_GROUP: Final = r"(?P<hour>\d{1,2})\s*시(?:\s*(?P<minute>\d{1,2})\s*분)?"
_TIME_PATTERN: Final = re.compile(_MERIDIEM_GROUP + _CLOCK_GROUP)
_ISO_DATE_PATTERN: Final = re.compile(r"\d{4}-\d{2}-\d{2}")

_HOURS_CONTEXT: Final = re.compile(r"영업|문\s*을?|마감|오픈|open|close|열|닫|시작|종료|폐점|개점")
_OPENING_WORDS: Final = re.compile(r"열|오픈|시작|개점")
_CLOSING_WORDS: Final = re.compile(r"닫|마감|종료|폐점|까지")
_CLOSURE_WORDS: Final = re.compile(r"휴무|휴일|쉬")

# Hours that read as the second half of the day when spoken with these words.
_AFTERNOON_MERIDIEMS: Final = frozenset({"오후", "저녁", "밤"})
_MORNING_MERIDIEMS: Final = frozenset({"새벽", "아침", "오전"})


def _to_24_hour(meridiem: str | None, hour: int, minute: int) -> str | None:
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
        # "밤 12시" is midnight; "오후 12시" is noon and stays as it is.
        resolved = 0 if (meridiem == "밤" and hour == NOON) else hour % NOON + NOON
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
    # A bare keyword is not a name the owner actually said.
    if name in {"메뉴", "대표", "이름", "명"}:
        return None
    return RepresentativeMenuNameChange(
        field="representativeMenuName",
        current_value=profile.representative_menu_name,
        proposed_value=name,
    )


def _parse_business_hours(text: str, profile: StoreProfile) -> ProposalChange | None:
    """Read an opening or closing time, or None when the sentence is not one."""
    if _HOURS_CONTEXT.search(text) is None:
        return None
    match = _TIME_PATTERN.search(text)
    if match is None:
        return None
    spoken = _to_24_hour(
        match.group("meridiem"),
        int(match.group("hour")),
        int(match.group("minute") or 0),
    )
    if spoken is None:
        return None

    try:
        current = BusinessHoursValue.model_validate(profile.business_hours)
    except ValidationError:
        return None

    # Which side of the day was spoken about. Saying nothing means closing time,
    # which is what "몇 시까지" asks; an explicit closing word wins over an
    # incidental "열" inside a word like "열심히".
    opens = _OPENING_WORDS.search(text) is not None and _CLOSING_WORDS.search(text) is None
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


def _parse_temporary_closure(text: str, profile: StoreProfile) -> ProposalChange | None:
    """Read a dated closure, or None when the dates are not both explicit.

    Relative wording such as "다음 주" carries no date this parser can resolve, so
    it declines instead of choosing one.
    """
    if _CLOSURE_WORDS.search(text) is None:
        return None
    found = [match.group() for match in _ISO_DATE_PATTERN.finditer(text)]
    if len(found) != DATE_PAIR:
        return None
    try:
        start, end = (date.fromisoformat(value) for value in found)
    except ValueError:
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


def parse_intent(masked_text: str, profile: StoreProfile) -> tuple[ProposalChange, ...] | None:
    """Turn a clear sentence into validated changes without calling a model.

    Args:
        masked_text: The recognized sentence, already stripped of customer PII.
        profile: The store the change applies to, used for every currentValue.

    Returns:
        The changes the sentence plainly states, or None when it should be read by
        the model instead. None is never an error — it is the handoff.
    """
    text = masked_text.strip()
    if not text:
        return None

    # Menu first: "메뉴를 …로 바꿔줘" can contain a word the hours branch reacts to.
    for read in (_parse_menu, _parse_temporary_closure, _parse_business_hours):
        change = read(text, profile)
        if change is not None:
            return (change,)
    return None


__all__ = ["parse_intent"]
