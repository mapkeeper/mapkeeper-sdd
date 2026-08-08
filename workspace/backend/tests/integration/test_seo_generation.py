from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.adapters.seo_generation import DeterministicSEOStub
from mapkeeper.api.schemas.seo import ContentGenerationInput, PlatformContentResult
from mapkeeper.core.errors import InvalidStateError, ResourceNotFoundError
from mapkeeper.models import ContentGenerationStatus, LocalSEOContent, SourceReview, StoreProfile
from mapkeeper.services.seo_generation import (
    create_generation,
    regenerate_generation,
    reject_generation,
)

from .factories import make_generation, make_store_profile

pytestmark = pytest.mark.asyncio


class CapturingGenerator:
    captured_brief_text: str
    captured_seed_keywords: tuple[str, ...]
    captured_source_reviews: tuple[str, ...]

    def __init__(self) -> None:
        self.captured_brief_text = ""
        self.captured_seed_keywords = ()
        self.captured_source_reviews = ()

    async def generate(
        self,
        content_input: ContentGenerationInput,
        profile: StoreProfile,
        source_reviews: tuple[str, ...],
    ) -> tuple[PlatformContentResult, ...]:
        self.captured_brief_text = content_input.brief_text
        self.captured_seed_keywords = tuple(content_input.seed_keywords)
        self.captured_source_reviews = source_reviews
        return await DeterministicSEOStub().generate(content_input, profile, source_reviews)


def generation_input(review_id: UUID | None = None) -> ContentGenerationInput:
    return ContentGenerationInput(
        brief_text="가족 외식에 어울리는 깊은 국물 맛을 소개해줘",
        seed_keywords=("만두전골", "가족외식"),
        source_review_ids=(review_id,) if review_id is not None else None,
    )


async def test_create_persists_input_three_drafts_and_only_masked_review(
    db_session: AsyncSession,
) -> None:
    profile = await make_store_profile(db_session)
    review = SourceReview(
        store_profile_id=profile.id,
        body_masked="고객 [이름]이 가족 외식으로 추천함",
    )
    db_session.add(review)
    await db_session.flush()

    result = await create_generation(db_session, generation_input(review.id), profile.id)
    drafts = (
        (
            await db_session.execute(
                select(LocalSEOContent).where(
                    LocalSEOContent.content_generation_id == result.generation_id
                )
            )
        )
        .scalars()
        .all()
    )

    assert result.status is ContentGenerationStatus.DRAFT
    assert result.revision == 1
    assert len(drafts) == 3
    assert len({draft.platform for draft in drafts}) == 3
    assert all("고객 홍길동" not in draft.draft_text for draft in drafts)


async def test_generation_masks_customer_pii_before_adapter_boundary(
    db_session: AsyncSession,
) -> None:
    profile = await make_store_profile(db_session)
    review = SourceReview(
        store_profile_id=profile.id,
        body_masked="고객 이름은 홍길동, 전화 010-1234-5678",
    )
    db_session.add(review)
    await db_session.flush()
    generator = CapturingGenerator()
    content_input = ContentGenerationInput(
        brief_text="고객 이름은 홍길동이고 전화는 010-1234-5678인 리뷰를 반영해줘",
        seed_keywords=("가족외식",),
        source_review_ids=(review.id,),
    )

    _ = await create_generation(db_session, content_input, profile.id, generator)

    assert "홍길동" not in generator.captured_brief_text
    assert "010-1234-5678" not in generator.captured_brief_text
    assert all("홍길동" not in review_text for review_text in generator.captured_source_reviews)
    assert all(
        "010-1234-5678" not in review_text for review_text in generator.captured_source_reviews
    )


async def test_regenerate_replaces_all_drafts_and_increments_revision(
    db_session: AsyncSession,
) -> None:
    profile = await make_store_profile(db_session)
    initial = await create_generation(db_session, generation_input(), profile.id)
    old_ids = {
        draft.id
        for draft in (
            await db_session.execute(
                select(LocalSEOContent).where(
                    LocalSEOContent.content_generation_id == initial.generation_id
                )
            )
        ).scalars()
    }

    regenerated = await regenerate_generation(
        db_session,
        initial.generation_id,
        ContentGenerationInput(brief_text="새로운 소개", seed_keywords=("점심",)),
    )
    new_ids = {draft.draft_id for draft in regenerated.drafts}

    assert regenerated.revision == 2
    assert new_ids.isdisjoint(old_ids)
    assert len(new_ids) == 3


@pytest.mark.parametrize(
    "status", [ContentGenerationStatus.APPROVED, ContentGenerationStatus.REJECTED]
)
async def test_rejecting_a_non_draft_is_refused(
    db_session: AsyncSession,
    status: ContentGenerationStatus,
) -> None:
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id, status=status)

    with pytest.raises(InvalidStateError):
        _ = await reject_generation(db_session, generation.id)


async def test_source_review_must_belong_to_the_store(db_session: AsyncSession) -> None:
    profile = await make_store_profile(db_session)

    with pytest.raises(ResourceNotFoundError):
        _ = await create_generation(db_session, generation_input(uuid4()), profile.id)
