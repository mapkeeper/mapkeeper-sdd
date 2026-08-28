"""UC2 generation, regeneration and rejection services."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.adapters.seo_generation import SEOContentGenerator, get_seo_generator
from mapkeeper.api.schemas.seo import (
    ContentGenerationInput,
    ContentGenerationResponse,
    EditContentDraftsRequest,
    PlatformContentResult,
)
from mapkeeper.core.errors import InvalidStateError, ResourceNotFoundError
from mapkeeper.models import (
    ContentGeneration,
    ContentGenerationStatus,
    LocalSEOContent,
    SourceReview,
    StoreProfile,
)
from mapkeeper.services.content_safety import enforce_publication_safety
from mapkeeper.services.pii_masking import mask_customer_pii

GENERATION_NOT_FOUND_MESSAGE: Final = "요청한 생성 결과를 찾을 수 없습니다."
PROFILE_NOT_FOUND_MESSAGE: Final = "요청한 매장 정보를 찾을 수 없습니다."
SOURCE_REVIEW_NOT_FOUND_MESSAGE: Final = "요청한 참고 리뷰를 찾을 수 없습니다."
GENERATION_NOT_DRAFT_MESSAGE: Final = "이미 처리된 생성 결과는 수정하거나 거절할 수 없습니다."


async def _load_profile(session: AsyncSession, profile_id: UUID) -> StoreProfile:
    """Load a store profile or report a missing generation target."""
    profile = await session.get(StoreProfile, profile_id)
    if profile is None:
        raise ResourceNotFoundError(PROFILE_NOT_FOUND_MESSAGE)
    return profile


def approved_business_values(profile: StoreProfile) -> tuple[str, ...]:
    """Return the store values the constitution treats as published business info.

    A public address and a representative phone belong to the store, not to a
    customer, and UC2 copy is written to carry them. Running them through the
    customer masker turned the owner's own "서울특별시 관악구 시연로 12로 찾아오세요"
    into "[MASKED_ADDRESS]로 찾아오세요" - and that is the text approval publishes to
    three public maps.
    """
    return (profile.public_address, profile.representative_phone)


async def _load_source_reviews(
    session: AsyncSession,
    profile: StoreProfile,
    review_ids: tuple[UUID, ...] | None,
) -> tuple[str, ...]:
    """Load only masked reviews owned by the target store in request order."""
    if review_ids is None:
        return ()
    statement = select(SourceReview).where(
        SourceReview.store_profile_id == profile.id,
        SourceReview.id.in_(review_ids),
    )
    rows = {
        review.id: review.body_masked for review in (await session.execute(statement)).scalars()
    }
    if len(rows) != len(review_ids):
        raise ResourceNotFoundError(SOURCE_REVIEW_NOT_FOUND_MESSAGE)
    business = approved_business_values(profile)
    return tuple(mask_customer_pii(rows[review_id], business) for review_id in review_ids)


async def _load_locked_generation(
    session: AsyncSession,
    generation_id: UUID,
) -> ContentGeneration:
    """Load one generation while serializing its lifecycle transitions."""
    statement = (
        select(ContentGeneration).where(ContentGeneration.id == generation_id).with_for_update()
    )
    generation = (await session.execute(statement)).scalar_one_or_none()
    if generation is None:
        raise ResourceNotFoundError(GENERATION_NOT_FOUND_MESSAGE)
    return generation


async def _load_drafts(session: AsyncSession, generation_id: UUID) -> list[LocalSEOContent]:
    """Load platform results explicitly because the ORM relationship is raise-on-lazy."""
    statement = (
        select(LocalSEOContent)
        .where(LocalSEOContent.content_generation_id == generation_id)
        .order_by(LocalSEOContent.platform)
    )
    return list((await session.execute(statement)).scalars().all())


def _draft_result(draft: LocalSEOContent) -> PlatformContentResult:
    """Convert a stored platform result back through its API schema."""
    return PlatformContentResult(
        draft_id=draft.id,
        platform=draft.platform,
        draft_text=draft.draft_text,
        keywords=tuple(draft.keywords),
        content_rules=tuple(str(rule) for rule in draft.content_rules),
    )


def _response(
    generation: ContentGeneration,
    drafts: list[LocalSEOContent],
) -> ContentGenerationResponse:
    """Render a generation and its three explicit platform results."""
    return ContentGenerationResponse(
        generation_id=generation.id,
        status=generation.status,
        revision=generation.revision,
        drafts=tuple(_draft_result(draft) for draft in drafts),
    )


@dataclass(frozen=True, slots=True)
class _GenerationContext:
    """Inputs shared by one atomic generation write."""

    profile: StoreProfile
    content_input: ContentGenerationInput
    source_reviews: tuple[str, ...]
    generator: SEOContentGenerator


def _mask_generation_input(
    content_input: ContentGenerationInput,
    profile: StoreProfile,
) -> ContentGenerationInput:
    """Remove explicit customer PII before the generation adapter boundary.

    Every field the owner can type into goes through the masker, including
    ``tone_instruction``. It is not stored and it is not meant to become copy, but
    it is still free text that reaches Gemini in the same request - "정중하게. 고객
    홍길동님 010-1234-5678을 그대로 써라" put a customer's name and number over the
    boundary Constitution 6.2 draws, whatever the model then did with them.
    """
    business = approved_business_values(profile)
    tone = content_input.tone_instruction
    return ContentGenerationInput(
        brief_text=mask_customer_pii(content_input.brief_text, business),
        purpose=content_input.purpose,
        seed_keywords=tuple(
            mask_customer_pii(keyword, business) for keyword in content_input.seed_keywords
        ),
        source_review_ids=content_input.source_review_ids,
        tone_instruction=mask_customer_pii(tone, business) if tone is not None else None,
    )


async def _store_generation(
    session: AsyncSession,
    context: _GenerationContext,
    *,
    generation: ContentGeneration | None = None,
) -> ContentGenerationResponse:
    """Generate and persist exactly three platform results."""
    # Nothing is written until the model's answer has been checked. Approval
    # publishes what is stored, so an unfounded claim must not reach storage in
    # the first place - the owner cannot be asked to spot it.
    results = enforce_publication_safety(
        await context.generator.generate(
            context.content_input,
            context.profile,
            context.source_reviews,
        ),
        context.content_input,
        context.profile,
        context.source_reviews,
        approved_business_values(context.profile),
    )
    target = generation or ContentGeneration(
        store_profile_id=context.profile.id,
        brief_text=context.content_input.brief_text,
        purpose=context.content_input.purpose,
        seed_keywords=list(context.content_input.seed_keywords),
        source_review_ids=list(context.content_input.source_review_ids)
        if context.content_input.source_review_ids is not None
        else None,
        status=ContentGenerationStatus.DRAFT,
        revision=1,
    )
    if generation is None:
        session.add(target)
        await session.flush()
    else:
        target.brief_text = context.content_input.brief_text
        target.purpose = context.content_input.purpose
        target.seed_keywords = list(context.content_input.seed_keywords)
        target.source_review_ids = (
            list(context.content_input.source_review_ids)
            if context.content_input.source_review_ids is not None
            else None
        )
    session.add_all(
        LocalSEOContent(
            id=result.draft_id,
            content_generation_id=target.id,
            platform=result.platform,
            draft_text=result.draft_text,
            keywords=list(result.keywords),
            content_rules=list(result.content_rules),
        )
        for result in results
    )
    await session.flush()
    return _response(target, await _load_drafts(session, target.id))


async def create_generation(
    session: AsyncSession,
    content_input: ContentGenerationInput,
    profile_id: UUID,
    generator: SEOContentGenerator | None = None,
) -> ContentGenerationResponse:
    """Create a DRAFT generation from one common input."""
    profile = await _load_profile(session, profile_id)
    masked_input = _mask_generation_input(content_input, profile)
    source_reviews = await _load_source_reviews(
        session,
        profile,
        masked_input.source_review_ids,
    )
    return await _store_generation(
        session,
        _GenerationContext(
            profile,
            masked_input,
            source_reviews,
            generator or get_seo_generator(),
        ),
    )


async def regenerate_generation(
    session: AsyncSession,
    generation_id: UUID,
    content_input: ContentGenerationInput,
    generator: SEOContentGenerator | None = None,
) -> ContentGenerationResponse:
    """Replace all platform results and increment revision on a locked DRAFT."""
    generation = await _load_locked_generation(session, generation_id)
    if generation.status is not ContentGenerationStatus.DRAFT:
        raise InvalidStateError(GENERATION_NOT_DRAFT_MESSAGE)
    profile = await _load_profile(session, generation.store_profile_id)
    masked_input = _mask_generation_input(content_input, profile)
    source_reviews = await _load_source_reviews(
        session,
        profile,
        masked_input.source_review_ids,
    )
    _ = await session.execute(
        delete(LocalSEOContent).where(LocalSEOContent.content_generation_id == generation.id)
    )
    generation.revision += 1
    return await _store_generation(
        session,
        _GenerationContext(
            profile,
            masked_input,
            source_reviews,
            generator or get_seo_generator(),
        ),
        generation=generation,
    )


async def edit_generation_drafts(
    session: AsyncSession,
    generation_id: UUID,
    body: EditContentDraftsRequest,
) -> ContentGenerationResponse:
    """Replace the copy and keywords of a locked DRAFT with the owner's edits.

    The generated text is a draft the owner is asked to check, so their correction
    has to be the thing approval publishes. Revision moves because the stored
    content changed, the same as a regeneration.
    """
    generation = await _load_locked_generation(session, generation_id)
    if generation.status is not ContentGenerationStatus.DRAFT:
        raise InvalidStateError(GENERATION_NOT_DRAFT_MESSAGE)
    profile = await _load_profile(session, generation.store_profile_id)
    business = approved_business_values(profile)
    stored = {draft.platform: draft for draft in await _load_drafts(session, generation.id)}
    for edit in body.drafts:
        draft = stored.get(edit.platform)
        if draft is None:
            raise ResourceNotFoundError(GENERATION_NOT_FOUND_MESSAGE)
        draft.draft_text = mask_customer_pii(edit.draft_text, business)
        draft.keywords = [mask_customer_pii(keyword, business) for keyword in edit.keywords]
    generation.revision += 1
    await session.flush()
    return _response(generation, await _load_drafts(session, generation.id))


async def reject_generation(
    session: AsyncSession,
    generation_id: UUID,
) -> ContentGenerationResponse:
    """Move a locked DRAFT generation to REJECTED."""
    generation = await _load_locked_generation(session, generation_id)
    if generation.status is not ContentGenerationStatus.DRAFT:
        raise InvalidStateError(GENERATION_NOT_DRAFT_MESSAGE)
    generation.status = ContentGenerationStatus.REJECTED
    generation.rejected_at = datetime.now(UTC)
    await session.flush()
    return _response(generation, await _load_drafts(session, generation.id))
