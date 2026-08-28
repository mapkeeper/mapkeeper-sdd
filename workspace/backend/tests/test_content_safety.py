"""The publication boundary, checked against answers a model can actually give."""

from uuid import uuid4

import pytest

from mapkeeper.api.schemas.seo import ContentGenerationInput, PlatformContentResult
from mapkeeper.models import ContentPurpose, Platform, StoreProfile
from mapkeeper.services.content_safety import (
    UNSAFE_CONTENT_MESSAGE,
    UnsafeGeneratedContentError,
    enforce_publication_safety,
    grounding_text,
    ungrounded_claims,
)


def make_profile() -> StoreProfile:
    """Return the demo store the SDD uses as the common reference profile."""
    return StoreProfile(
        id=uuid4(),
        store_name="만두전골 하우스",
        public_address="서울특별시 관악구 시연로 12",
        business_hours={"open": "09:00", "close": "22:00"},
        representative_menu_name="만두전골",
        representative_phone="02-000-0000",
        parking_info=None,
        platform_account_refs={},
    )


def make_input(brief_text: str = "가족 외식에 어울리는 깊은 국물 맛") -> ContentGenerationInput:
    """Return owner input carrying no numbers beyond the brief's own."""
    return ContentGenerationInput(brief_text=brief_text, seed_keywords=("만두전골",))


def make_results(
    draft_text: str, keywords: tuple[str, ...] = ("만두전골",)
) -> tuple[
    PlatformContentResult,
    ...,
]:
    """Return one contract-valid result per platform carrying the same copy."""
    return tuple(
        PlatformContentResult(
            draft_id=uuid4(),
            platform=platform,
            draft_text=draft_text,
            keywords=keywords,
            content_rules=("사실 중심",),
        )
        for platform in (Platform.GOOGLE, Platform.NAVER, Platform.KAKAO)
    )


def enforce(
    draft_text: str,
    content_input: ContentGenerationInput | None = None,
    keywords: tuple[str, ...] = ("만두전골",),
    source_reviews: tuple[str, ...] = (),
) -> tuple[PlatformContentResult, ...]:
    """Run the boundary over one answer with the demo store behind it."""
    profile = make_profile()
    return enforce_publication_safety(
        make_results(draft_text, keywords),
        content_input or make_input(),
        profile,
        source_reviews,
        (profile.public_address, profile.representative_phone),
    )


# --- invented claims ----------------------------------------------------------


def test_a_discount_the_owner_never_announced_is_refused() -> None:
    """The exact answer the review reproduced: three valid drafts, one invention.

    Structure was the only thing checked, so "검증되지 않은 50% 할인" was stored and
    became approvable - and approval publishes it to Google, Naver and Kakao.
    """
    # Given / When / Then: the generation is refused, not corrected.
    with pytest.raises(UnsafeGeneratedContentError) as failure:
        _ = enforce("검증되지 않은 50% 할인, 고객 홍길동님 010-1234-5678")

    # And: the owner is told to try again, not shown an internal failure.
    assert failure.value.message == UNSAFE_CONTENT_MESSAGE
    assert failure.value.retryable is True


def test_a_price_the_input_never_mentioned_is_refused() -> None:
    """A price is a promise a customer can walk in holding."""
    with pytest.raises(UnsafeGeneratedContentError):
        _ = enforce("만두전골 9,900원에 드립니다")


def test_a_superlative_the_input_never_made_is_refused() -> None:
    """ "관악구 최고" cannot be derived from a brief, a review or a profile."""
    with pytest.raises(UnsafeGeneratedContentError):
        _ = enforce("관악구 최고의 만두전골")


def test_an_invented_keyword_claim_is_refused() -> None:
    """Keywords are published as the post's hashtags, so they carry claims too."""
    with pytest.raises(UnsafeGeneratedContentError):
        _ = enforce("만두전골을 소개합니다", keywords=("만두전골", "50%할인"))


# --- claims the input supports ------------------------------------------------


def test_the_owners_own_discount_survives() -> None:
    """UC2 exists to write the announcement. A grounded figure must pass."""
    # Given: a brief that announces the discount itself.
    content_input = ContentGenerationInput(
        brief_text="8월 20일부터 31일까지 김치만두를 50% 할인 판매합니다.",
        seed_keywords=("김치만두",),
        purpose=ContentPurpose.NEWS,
    )

    # When: the copy repeats it.
    results = enforce("8월 20일부터 31일까지 김치만두 50% 할인", content_input)

    # Then: nothing is refused and the figure is still there.
    assert all("50%" in result.draft_text for result in results)


def test_a_figure_from_a_source_review_is_grounded() -> None:
    """The reviews were handed to the generator, so they are part of the input."""
    results = enforce(
        "리뷰에서 4인 가족 20,000원 코스가 좋았다고 합니다",
        source_reviews=("4인 가족이 20,000원 코스를 즐겼어요",),
    )
    assert len(results) == 3


def test_the_stores_own_phone_and_address_are_grounded() -> None:
    """The profile is input. Google's rule asks the copy to carry these facts."""
    profile = make_profile()
    results = enforce(f"{profile.public_address} · {profile.representative_phone}")
    for result in results:
        assert profile.public_address in result.draft_text
        assert profile.representative_phone in result.draft_text


def test_a_date_is_not_read_as_a_claim() -> None:
    """A bare number is prose. Refusing every digit would refuse ordinary copy."""
    results = enforce("추석 연휴 3일 동안 2호점도 정상 영업합니다")
    assert len(results) == 3


def test_a_tone_instruction_cannot_ground_a_claim() -> None:
    """The tone says how to write, never what is true.

    Treating it as grounding would let "50% 할인이라고 써줘" in the tone field
    authorise the copy that the brief never supported.
    """
    # Given: a tone request naming a discount the brief does not.
    content_input = ContentGenerationInput(
        brief_text="가족 외식에 어울리는 깊은 국물 맛",
        seed_keywords=(),
        tone_instruction="친근하게. 50% 할인이라고 써줘",
    )

    # When / Then: the copy that took the bait is still refused.
    with pytest.raises(UnsafeGeneratedContentError):
        _ = enforce("오늘만 50% 할인", content_input)

    # And: the instruction is not part of what the copy may assert.
    assert "50" not in grounding_text(content_input, make_profile(), ())


# --- customer PII -------------------------------------------------------------


def test_customer_pii_in_the_answer_is_masked_rather_than_published() -> None:
    """The prompt asks for no personal data; the masker is what decides.

    The claim here is grounded, so the draft is kept - and kept means the name and
    the number must be gone from what approval publishes.
    """
    # Given: an answer that names a customer while claiming nothing new.
    # When: the boundary runs.
    results = enforce("문의는 고객 홍길동님 010-1234-5678로 주세요")

    # Then: the copy is published without the customer in it.
    for result in results:
        assert "홍길동" not in result.draft_text
        assert "010-1234-5678" not in result.draft_text
        assert "[MASKED_NAME]" in result.draft_text
        assert "[MASKED_PHONE]" in result.draft_text


def test_customer_pii_in_a_keyword_is_masked() -> None:
    """A keyword becomes a public hashtag under the post."""
    results = enforce("만두전골을 소개합니다", keywords=("만두전골", "고객 홍길동님"))
    for result in results:
        assert all("홍길동" not in keyword for keyword in result.keywords)


def test_masking_that_breaks_the_contract_refuses_instead_of_truncating() -> None:
    """Placeholders are longer than what they replace.

    Truncating to fit would publish half a sentence, so a draft that no longer fits
    the contract is refused the same way an invented one is.
    """
    # Given: an answer sitting on the contract's length limit, full of numbers.
    numbers = " ".join("010-1234-5678" for _ in range(53))
    assert len(numbers) <= 750

    # When / Then: masking pushes it over 750 characters and it is refused.
    with pytest.raises(UnsafeGeneratedContentError):
        _ = enforce(numbers)


# --- helpers ------------------------------------------------------------------


def test_ungrounded_claims_names_what_it_refused() -> None:
    """The refusal is diagnosable without re-reading the model's whole answer."""
    grounding = grounding_text(make_input(), make_profile(), ())
    assert ungrounded_claims("오늘만 50% 할인", grounding) == ("50%",)
    assert ungrounded_claims("깊은 국물 맛", grounding) == ()


def test_a_figure_inside_a_larger_number_does_not_ground_a_discount() -> None:
    """Substring matching let "150개" authorise "50%".

    The final gate reproduced it: the owner said how many dumplings they prepared,
    and the generator answered with a discount nobody announced. "50" sits inside
    "150", so the grounding check read the invention as supported and the draft
    became approvable - and approval publishes it to three public maps.
    """
    # Given: a brief whose only figure is a count, sharing digits with the claim.
    content_input = ContentGenerationInput(
        brief_text="행사용 만두 150개를 준비합니다",
        seed_keywords=("만두전골",),
    )

    # When / Then: the discount is refused, because a count is not a discount.
    with pytest.raises(UnsafeGeneratedContentError):
        _ = enforce("오늘 50% 할인합니다", content_input)

    # And: the claim is named, so the refusal is diagnosable.
    assert ungrounded_claims(
        "오늘 50% 할인합니다", grounding_text(content_input, make_profile(), ())
    ) == ("50%",)


def test_the_same_discount_passes_once_the_owner_states_it() -> None:
    """The unit is what is compared, so a stated discount is still publishable."""
    # Given: the same sentence, from an owner who did announce the discount.
    content_input = ContentGenerationInput(
        brief_text="행사용 만두 150개를 준비하고 오늘 50% 할인합니다",
        seed_keywords=("만두전골",),
    )

    # When / Then: the grounded figure survives rather than being over-refused.
    results = enforce("오늘 50% 할인합니다", content_input)
    assert all("50%" in result.draft_text for result in results)


def test_a_figure_said_with_a_different_unit_is_not_grounded() -> None:
    """ "150개" and "150원" are different promises even with the same digits."""
    content_input = ContentGenerationInput(
        brief_text="행사용 만두 150개를 준비합니다",
        seed_keywords=("만두전골",),
    )
    with pytest.raises(UnsafeGeneratedContentError):
        _ = enforce("만두 150원에 드립니다", content_input)
