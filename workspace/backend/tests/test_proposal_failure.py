"""T256: the machine-readable cause a refused UC1 sentence comes back with."""

from datetime import date
from typing import Final

import pytest

from mapkeeper.models.enums import ProposalFailureReason
from mapkeeper.services.proposal_failure import build_failure, classify, no_effective_change_error

TODAY: Final = date(2026, 9, 1)


@pytest.mark.parametrize(
    ("sentence", "expected"),
    [
        # A time of day with no hour in it. The owner has to be asked for the
        # clock time, not the date.
        ("오후에 문을 닫습니다", ProposalFailureReason.AMBIGUOUS_TIME),
        ("영업시간을 오후 25시까지로 바꿔줘", ProposalFailureReason.AMBIGUOUS_TIME),
        # A closure with nothing to pin the day on.
        ("조만간 쉽니다", ProposalFailureReason.AMBIGUOUS_DATE),
        # A range whose far end cannot be resolved. Naming it is what keeps the
        # store from reopening while the owner is still away.
        ("9월 1일부터 나중까지 쉽니다", ProposalFailureReason.UNREADABLE_DATE_RANGE),
        # A day no calendar has, and a range that ends before it starts.
        ("2월 30일 휴무", ProposalFailureReason.INVALID_DATE),
        ("2026-09-05 부터 2026-09-01 까지 휴무", ProposalFailureReason.INVALID_DATE),
        # More than one menu for a field that stores exactly one.
        ("대표 메뉴를 김치찌개와 냉면으로 바꿔줘", ProposalFailureReason.MULTIPLE_MENU_CANDIDATES),
        # A field this MVP does not carry at all.
        ("대표 전화번호를 010-1234-5678로 바꿔줘", ProposalFailureReason.UNSUPPORTED_FIELD),
        ("오늘 날씨 어때?", ProposalFailureReason.UNSUPPORTED_FIELD),
    ],
)
def test_each_refusal_names_what_the_owner_has_to_change(
    sentence: str,
    expected: ProposalFailureReason,
) -> None:
    # Given: a sentence that cannot become a change.
    # When: it is diagnosed.
    failure = classify(sentence, TODAY)

    # Then: the reason distinguishes this failure from every other one, so the
    # screen can ask for the one thing that is missing instead of "다시 확인해
    # 주세요".
    assert failure.reason is expected


def test_a_refusal_carries_guidance_a_retry_and_the_original_sentence() -> None:
    # Given: a sentence the parser cannot read.
    sentence = "오후에 문을 닫습니다"

    # When: it is diagnosed.
    failure = classify(sentence, TODAY)

    # Then: everything the screen needs to offer a retry is present, including the
    # owner's own words - losing those made them start the task over.
    assert failure.message.strip() != ""
    assert failure.guidance.strip() != ""
    assert failure.retry.strip() != ""
    assert failure.examples != ()
    assert failure.recognized_text_masked == sentence


@pytest.mark.parametrize("reason", list(ProposalFailureReason))
def test_every_reason_has_copy_a_person_can_act_on(reason: ProposalFailureReason) -> None:
    # Given: any reason the classifier can return.
    # When: it is rendered.
    failure = build_failure(reason, "내일 하루 쉽니다")

    # Then: no reason reaches a caller as a bare enum with nothing to do about it.
    assert failure.reason is reason
    assert failure.message.strip() != ""
    assert failure.guidance.strip() != ""
    assert failure.retry.strip() != ""
    assert failure.examples != ()


def test_a_change_that_matches_the_store_is_refused_with_its_own_reason() -> None:
    # Given: a sentence whose values already match the stored profile.
    sentence = "대표 메뉴를 만두전골로 바꿔줘"

    # When: the 409 is built.
    error = no_effective_change_error(sentence, "현재 매장 정보와 달라진 내용이 없습니다.")

    # Then: it is a distinct cause, not the same "could not read it" refusal.
    assert error.failure is not None
    assert error.failure.reason is ProposalFailureReason.NO_EFFECTIVE_CHANGE
    assert error.failure.recognized_text_masked == sentence
