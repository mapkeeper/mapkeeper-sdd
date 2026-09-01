"""Turn a refused UC1 sentence into a cause the owner can act on.

A 422 that says only "입력값을 확인해 주세요." ends the task. The owner cannot tell
whether the problem was the hour, the date, the menu or the field itself, and the
sentence they spoke is gone from the screen, so the next attempt is a guess. Every
refusal built here names the cause in machine-readable form, says what to change,
gives a sentence that works, and carries the masked input back so the screen can
put their own words in front of them again.

The copy lives beside the classification rather than inside the parser: the parser
decides *what* went wrong, this module decides *what to say about it*.
"""

from dataclasses import dataclass
from datetime import date
from typing import Final, final

from mapkeeper.adapters.intent import classify_failure_reason
from mapkeeper.api.schemas.common import ProposalFailure
from mapkeeper.core.errors import InvalidStateError
from mapkeeper.models.enums import ProposalFailureReason

CLOSURE_EXAMPLE: Final = "내일 하루 쉽니다"
RANGE_EXAMPLE: Final = "다음 주 월요일부터 수요일까지 쉽니다"
HOURS_EXAMPLE: Final = "영업시간을 밤 10시까지로 바꿔줘"
MENU_EXAMPLE: Final = "대표 메뉴를 김치찌개로 바꿔줘"
PARKING_EXAMPLE: Final = "주차 정보를 건물 뒤 3대 가능으로 바꿔줘"

SUPPORTED_FIELDS_SENTENCE: Final = "바꿀 수 있는 건 영업시간, 임시 휴무, 대표 메뉴, 주차 정보예요."


@final
@dataclass(frozen=True, slots=True)
class _Copy:
    """The three sentences and the examples each reason needs."""

    message: str
    guidance: str
    retry: str
    examples: tuple[str, ...]


_COPY: Final[dict[ProposalFailureReason, _Copy]] = {
    ProposalFailureReason.AMBIGUOUS_TIME: _Copy(
        message="몇 시인지 정확히 알 수 없어요.",
        guidance=(
            "“오후”, “저녁”처럼 대략적인 때만 말씀하셨거나 "
            "시계에 없는 시각이라 시각을 정하지 못했어요."
        ),
        retry=(
            "몇 시인지 함께 말씀해 주세요. 하루 종일 쉬시는 거라면 시각 대신 날짜로 말씀해 주세요."
        ),
        examples=(HOURS_EXAMPLE, CLOSURE_EXAMPLE),
    ),
    ProposalFailureReason.AMBIGUOUS_DATE: _Copy(
        message="며칠인지 정확히 알 수 없어요.",
        guidance="“조만간”처럼 날짜를 특정할 수 없는 표현이라 며칠인지 정하지 못했어요.",
        retry="“내일”, “다음 주 월요일”, “9월 1일”처럼 날짜를 함께 말씀해 주세요.",
        examples=(CLOSURE_EXAMPLE, "9월 1일은 임시 휴무입니다"),
    ),
    ProposalFailureReason.UNREADABLE_DATE_RANGE: _Copy(
        message="기간의 시작일과 종료일을 모두 읽지 못했어요.",
        guidance=(
            "쉬시는 기간을 말씀하셨지만 끝나는 날을 정하지 못했어요. "
            "한쪽만 반영하면 실제보다 짧게 쉬는 것으로 올라가요."
        ),
        retry="시작일과 종료일을 모두 말씀해 주세요.",
        examples=(RANGE_EXAMPLE, "9월 1일부터 9월 3일까지 쉽니다"),
    ),
    ProposalFailureReason.INVALID_DATE: _Copy(
        message="말씀하신 날짜를 그대로 쓸 수 없어요.",
        guidance="말씀하신 날짜가 실제로 없는 날이거나, 끝나는 날이 시작하는 날보다 앞서 있어요.",
        retry="실제 있는 날짜로, 시작일이 종료일보다 앞서도록 다시 말씀해 주세요.",
        examples=("9월 1일은 임시 휴무입니다", RANGE_EXAMPLE),
    ),
    ProposalFailureReason.MULTIPLE_MENU_CANDIDATES: _Copy(
        message="대표 메뉴를 하나로 정하지 못했어요.",
        guidance="대표 메뉴는 한 개만 저장할 수 있는데 여러 개를 말씀하셨어요.",
        retry="대표로 올릴 메뉴 하나만 말씀해 주세요.",
        examples=(MENU_EXAMPLE,),
    ),
    ProposalFailureReason.UNSUPPORTED_FIELD: _Copy(
        message="지금은 바꿀 수 없는 항목이에요.",
        guidance=SUPPORTED_FIELDS_SENTENCE,
        retry="네 항목 중 하나를 골라 다시 말씀해 주세요.",
        examples=(HOURS_EXAMPLE, CLOSURE_EXAMPLE, MENU_EXAMPLE, PARKING_EXAMPLE),
    ),
    ProposalFailureReason.NO_CHANGE_FOUND: _Copy(
        message="말씀하신 내용에서 바꿀 항목을 찾지 못했어요.",
        guidance=SUPPORTED_FIELDS_SENTENCE,
        retry="바꾸실 항목과 값을 함께 말씀해 주세요.",
        examples=(HOURS_EXAMPLE, CLOSURE_EXAMPLE, MENU_EXAMPLE, PARKING_EXAMPLE),
    ),
    ProposalFailureReason.NO_EFFECTIVE_CHANGE: _Copy(
        message="현재 매장 정보와 달라진 내용이 없어요.",
        guidance="말씀하신 값이 지금 저장된 값과 같아서 바꿀 것이 없어요.",
        retry="지금과 다른 값으로 다시 말씀해 주세요.",
        examples=(HOURS_EXAMPLE, MENU_EXAMPLE),
    ),
}


def build_failure(reason: ProposalFailureReason, masked_text: str) -> ProposalFailure:
    """Render one refusal, carrying the masked sentence back for the retry box."""
    copy = _COPY[reason]
    return ProposalFailure(
        reason=reason,
        message=copy.message,
        guidance=copy.guidance,
        retry=copy.retry,
        examples=copy.examples,
        recognized_text_masked=masked_text,
    )


def classify(masked_text: str, today: date | None = None) -> ProposalFailure:
    """Diagnose a sentence no change could be read from."""
    return build_failure(classify_failure_reason(masked_text, today), masked_text)


def no_effective_change_error(masked_text: str, message: str) -> InvalidStateError:
    """Build the 409 raised when every proposed value already matches the store."""
    return InvalidStateError(
        message,
        failure=build_failure(ProposalFailureReason.NO_EFFECTIVE_CHANGE, masked_text),
    )


__all__ = ["build_failure", "classify", "no_effective_change_error"]
