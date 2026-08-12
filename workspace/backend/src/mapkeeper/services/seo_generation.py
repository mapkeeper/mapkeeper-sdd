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


async def _load_source_reviews(
    session: AsyncSession,
    profile_id: UUID,
    review_ids: tuple[UUID, ...] | None,
) -> tuple[str, ...]:
    """Load only masked reviews owned by the target store in request order."""
    if review_ids is None:
        return ()
    statement = select(SourceReview).where(
        SourceReview.store_profile_id == profile_id,
        SourceReview.id.in_(review_ids),
    )
    rows = {
        review.id: review.body_masked for review in (await session.execute(statement)).scalars()
    }
    if len(rows) != len(review_ids):
        raise ResourceNotFoundError(SOURCE_REVIEW_NOT_FOUND_MESSAGE)
    return tuple(mask_customer_pii(rows[review_id]) for review_id in review_ids)


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


def _mask_generation_input(content_input: ContentGenerationInput) -> ContentGenerationInput:
    """Remove explicit customer PII before the generation adapter boundary."""
    return ContentGenerationInput(
        brief_text=mask_customer_pii(content_input.brief_text),
        purpose=content_input.purpose,
        seed_keywords=tuple(mask_customer_pii(keyword) for keyword in content_input.seed_keywords),
        source_review_ids=content_input.source_review_ids,
    )


async def _store_generation(
    session: AsyncSession,
    context: _GenerationContext,
    *,
    generation: ContentGeneration | None = None,
) -> ContentGenerationResponse:
    """Generate and persist exactly three platform results."""
    results = await context.generator.generate(
        context.content_input,
        context.profile,
        context.source_reviews,
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
    masked_input = _mask_generation_input(content_input)
    source_reviews = await _load_source_reviews(
        session,
        profile.id,
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
    masked_input = _mask_generation_input(content_input)
    source_reviews = await _load_source_reviews(
        session,
        profile.id,
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
