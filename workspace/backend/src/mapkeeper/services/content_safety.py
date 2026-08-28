"""What a generator returns is checked before it can be stored or approved.

The prompt asks the model not to invent facts and not to write customer data. A
prompt is a request, not a guarantee, and approval publishes whatever was stored
to three public maps. So the two rules Specify UC2 and the API Contract state -
no customer PII, and no fact the input did not carry - are enforced here, on the
model's answer, by code that does not depend on the model cooperating:

- Customer PII is masked deterministically, the same masker the input boundary
  uses, so a draft that names a customer is fixed rather than published.
- A claim the input never made is refused outright. A number cannot be corrected
  into the right number, and a draft asserting "50% 할인" for a store that
  announced no discount is not something to hand the owner for approval.

This sits in the service rather than in one adapter because every generator -
Gemini today, the offline stub, whatever replaces them - reaches storage through
the same call.
"""

import re
from decimal import Decimal
from typing import Final

from pydantic import ValidationError

from mapkeeper.api.schemas.seo import ContentGenerationInput, PlatformContentResult
from mapkeeper.core.errors import MapKeeperError
from mapkeeper.core.logging import get_logger
from mapkeeper.models import StoreProfile
from mapkeeper.services.pii_masking import mask_customer_pii

logger = get_logger(__name__)

UNSAFE_CONTENT_MESSAGE: Final = "문구를 생성하지 못했습니다. 잠시 후 다시 시도해 주세요."

# A figure attached to one of these units is a promise to a customer - a price, a
# discount, a ranking. Bare numbers are left alone on purpose: "3인 가족", "2호점"
# and a date read as ordinary prose, and refusing them would refuse the grounded
# announcement UC2 exists to write.
NUMERIC_CLAIM_PATTERN: Final[re.Pattern[str]] = re.compile(
    r"(\d[\d,]*(?:\.\d+)?)\s*(%|퍼센트|만원|천원|원|배(?![가-힣])|위(?![가-힣])|등(?![가-힣]))"
)
# "퍼센트" and "%" are the same promise written two ways, so a brief announcing
# "50퍼센트 할인" still grounds copy that writes it as "50%".
_UNIT_SYNONYMS: Final = {"퍼센트": "%"}
# Superlatives assert a comparison against every other store. None of them can be
# derived from a brief, a review or a profile, so each one has to appear in the
# input before it may appear in the copy.
SUPERLATIVE_CLAIMS: Final = (
    "최고",
    "최상",
    "최초",
    "최대",
    "최저",
    "유일",
    "무조건",
    "보장",
    "완벽",
)


class UnsafeGeneratedContentError(MapKeeperError):
    """The generator answered with copy the input does not support.

    Retryable: the same request with a cooperative answer succeeds, so the owner
    is told to try again rather than shown an internal failure.
    """

    def __init__(self) -> None:
        """Report the fixed, caller-safe message."""
        super().__init__(UNSAFE_CONTENT_MESSAGE, retryable=True)


def _normalize(text: str) -> str:
    """Drop the separators that make the same figure look like a different one."""
    return text.replace(",", "").replace(" ", "")


def grounding_text(
    content_input: ContentGenerationInput,
    profile: StoreProfile,
    source_reviews: tuple[str, ...],
) -> str:
    """Return everything the copy is allowed to assert, as one searchable string.

    Exactly the material the prompt was given: the owner's brief and keywords, the
    store's own profile, and the masked reviews. ``tone_instruction`` is not in it
    - it says how to write, never what is true.
    """
    hours = profile.business_hours
    return _normalize(
        " ".join(
            (
                content_input.brief_text,
                *content_input.seed_keywords,
                *source_reviews,
                profile.store_name,
                profile.public_address,
                profile.representative_menu_name,
                profile.representative_phone,
                profile.parking_info or "",
                *(str(value) for value in hours.values()),
            )
        )
    )


def _figure_token(digits: str, unit: str) -> str:
    """Return one comparable token for a figure and the unit it was said with.

    The figure alone is not enough to compare on. "50" is a substring of "150", so
    a brief that only said how many dumplings were prepared read as support for a
    50% discount nobody announced - the exact bypass the final gate reproduced.
    Comparing the whole figure, unit included, is what makes "150개" stop
    authorising "50%".
    """
    return f"{Decimal(digits).normalize():f}{_UNIT_SYNONYMS.get(unit, unit)}"


def _figure_tokens(text: str) -> frozenset[str]:
    """Return every figure-with-unit ``text`` states, as comparable tokens."""
    return frozenset(
        _figure_token(match.group(1), match.group(2))
        for match in NUMERIC_CLAIM_PATTERN.finditer(_normalize(text))
    )


def ungrounded_claims(text: str, grounding: str) -> tuple[str, ...]:
    """Return the assertions in ``text`` that ``grounding`` does not support."""
    normalized = _normalize(text)
    supported = _figure_tokens(grounding)
    found = [
        match.group(0)
        for match in NUMERIC_CLAIM_PATTERN.finditer(normalized)
        if _figure_token(match.group(1), match.group(2)) not in supported
    ]
    found.extend(claim for claim in SUPERLATIVE_CLAIMS if claim in text and claim not in grounding)
    return tuple(found)


def _safe_result(
    result: PlatformContentResult,
    business_values: tuple[str, ...],
) -> PlatformContentResult:
    """Return the result with customer PII masked out of everything published.

    ``keywords`` are masked too: they are published as the post's hashtags, so a
    customer's name in one is as public as a customer's name in the copy.
    """
    return PlatformContentResult(
        draft_id=result.draft_id,
        platform=result.platform,
        draft_text=mask_customer_pii(result.draft_text, business_values),
        keywords=tuple(mask_customer_pii(keyword, business_values) for keyword in result.keywords),
        content_rules=result.content_rules,
    )


def enforce_publication_safety(
    results: tuple[PlatformContentResult, ...],
    content_input: ContentGenerationInput,
    profile: StoreProfile,
    source_reviews: tuple[str, ...],
    business_values: tuple[str, ...],
) -> tuple[PlatformContentResult, ...]:
    """Return storable results, or refuse the whole generation.

    Args:
        results: What the generator answered with.
        content_input: The masked owner input the generator was given.
        profile: The store the copy is written for.
        source_reviews: The masked reviews the generator was given.
        business_values: Store values the constitution treats as approved
            business information, kept out of the customer masker's way.

    Returns:
        The three results with customer PII masked.

    Raises:
        UnsafeGeneratedContentError: a draft asserted something the input did not,
            or masking pushed it outside the published contract.
    """
    try:
        safe = tuple(_safe_result(result, business_values) for result in results)
    except ValidationError as exc:
        # Masking can only lengthen text. A draft that no longer fits the contract
        # is not silently truncated - truncation publishes half a sentence.
        logger.warning("generated copy no longer fits the contract after masking: %s", exc.title)
        raise UnsafeGeneratedContentError from exc

    grounding = grounding_text(content_input, profile, source_reviews)
    for result in safe:
        claims = ungrounded_claims(result.draft_text, grounding)
        claims += ungrounded_claims(" ".join(result.keywords), grounding)
        if claims:
            # The claims themselves are logged: they came from the model, not from
            # the owner, so they carry no customer data to leak into the log.
            logger.warning(
                "refusing %s copy asserting %s, which the input does not support",
                result.platform.value,
                sorted(set(claims)),
            )
            raise UnsafeGeneratedContentError
    return safe


__all__ = [
    "UNSAFE_CONTENT_MESSAGE",
    "UnsafeGeneratedContentError",
    "enforce_publication_safety",
    "grounding_text",
    "ungrounded_claims",
]
