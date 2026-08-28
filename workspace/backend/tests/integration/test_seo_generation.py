from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.adapters.seo_generation import DeterministicSEOStub
from mapkeeper.api.routes.seo import create_generation as create_generation_route
from mapkeeper.api.schemas.seo import (
    ContentGenerationInput,
    CreateContentGenerationRequest,
    EditContentDraftsRequest,
    PlatformContentResult,
    PlatformDraftEdit,
)
from mapkeeper.core.errors import InvalidStateError, ResourceNotFoundError
from mapkeeper.models import (
    ContentGeneration,
    ContentGenerationStatus,
    ContentPurpose,
    LocalSEOContent,
    Platform,
    SourceReview,
    StoreProfile,
)
from mapkeeper.services import seo_generation as seo_generation_service
from mapkeeper.services.content_safety import (
    UNSAFE_CONTENT_MESSAGE,
    UnsafeGeneratedContentError,
)
from mapkeeper.services.seo_generation import (
    create_generation,
    edit_generation_drafts,
    regenerate_generation,
    reject_generation,
)

from .factories import make_generation, make_store_profile

pytestmark = pytest.mark.asyncio


class CapturingGenerator:
    captured_brief_text: str
    captured_seed_keywords: tuple[str, ...]
    captured_source_reviews: tuple[str, ...]
    captured_tone_instruction: str | None

    def __init__(self) -> None:
        self.captured_brief_text = ""
        self.captured_seed_keywords = ()
        self.captured_source_reviews = ()
        self.captured_tone_instruction = None

    async def generate(
        self,
        content_input: ContentGenerationInput,
        profile: StoreProfile,
        source_reviews: tuple[str, ...],
    ) -> tuple[PlatformContentResult, ...]:
        self.captured_brief_text = content_input.brief_text
        self.captured_seed_keywords = tuple(content_input.seed_keywords)
        self.captured_source_reviews = source_reviews
        self.captured_tone_instruction = content_input.tone_instruction
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


def draft_edits(text: str) -> EditContentDraftsRequest:
    """Render one owner edit per platform."""
    return EditContentDraftsRequest(
        drafts=tuple(
            PlatformDraftEdit(
                platform=platform,
                draft_text=f"{text} ({platform.value})",
                keywords=("사장님수정",),
            )
            for platform in (Platform.GOOGLE, Platform.NAVER, Platform.KAKAO)
        )
    )


async def test_owner_edits_replace_the_stored_copy_approval_will_publish(
    db_session: AsyncSession,
) -> None:
    # Given: a generation whose copy the owner corrected on the review screen.
    profile = await make_store_profile(db_session)
    initial = await create_generation(db_session, generation_input(), profile.id)

    # When: the edits are stored.
    edited = await edit_generation_drafts(
        db_session,
        initial.generation_id,
        draft_edits("사장님이 직접 고친 문구"),
    )

    # Then: what approval publishes is the text the owner read, not the original.
    assert edited.revision == 2
    assert all(draft.draft_text.startswith("사장님이 직접 고친 문구") for draft in edited.drafts)
    assert all(draft.keywords == ("사장님수정",) for draft in edited.drafts)
    stored = (
        await db_session.execute(
            select(LocalSEOContent).where(
                LocalSEOContent.content_generation_id == initial.generation_id
            )
        )
    ).scalars()
    assert all("사장님이 직접 고친 문구" in draft.draft_text for draft in stored)


async def test_owner_edits_are_masked_like_every_other_stored_text(
    db_session: AsyncSession,
) -> None:
    # Given: an edit carrying a customer's phone number.
    profile = await make_store_profile(db_session)
    initial = await create_generation(db_session, generation_input(), profile.id)

    # When: it is stored.
    edited = await edit_generation_drafts(
        db_session,
        initial.generation_id,
        draft_edits("문의는 010-1234-5678"),
    )

    # Then: the masking boundary holds for owner-written text too.
    assert all("010-1234-5678" not in draft.draft_text for draft in edited.drafts)


async def test_owner_edits_cannot_bypass_publication_safety(
    db_session: AsyncSession,
) -> None:
    # Given: a DRAFT whose original brief does not announce a discount.
    profile = await make_store_profile(db_session)
    initial = await create_generation(db_session, generation_input(), profile.id)
    unsupported = draft_edits("전 메뉴 90% 할인, 전국 1위 맛집, 만두전골 1만원")

    # When / Then: direct edits are held to the same grounding boundary as generation.
    with pytest.raises(UnsafeGeneratedContentError):
        _ = await edit_generation_drafts(db_session, initial.generation_id, unsupported)

    # And: the ungrounded copy is not stored for approval.
    assert all(
        "90%" not in draft.draft_text
        for draft in await _stored_drafts(db_session, initial.generation_id)
    )


@pytest.mark.parametrize(
    "status", [ContentGenerationStatus.APPROVED, ContentGenerationStatus.REJECTED]
)
async def test_editing_a_non_draft_is_refused(
    db_session: AsyncSession,
    status: ContentGenerationStatus,
) -> None:
    # Given: a generation that was already approved or rejected.
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id, status=status)

    # When / Then: settled content is not rewritten behind the decision.
    with pytest.raises(InvalidStateError):
        _ = await edit_generation_drafts(db_session, generation.id, draft_edits("늦은 수정"))


async def test_the_stores_own_public_values_survive_the_masking_boundary(
    db_session: AsyncSession,
) -> None:
    """An owner writing their own address is not writing customer PII.

    The constitution treats a public address and a representative phone as
    approved business information. Masking them turned the owner's own directions
    into "[MASKED_ADDRESS]로 찾아오세요" inside the brief the generator writes from.
    """
    # Given: a brief naming the store's own published values and a customer's number.
    profile = await make_store_profile(db_session)
    generator = CapturingGenerator()
    content_input = ContentGenerationInput(
        brief_text=(
            f"{profile.public_address}로 찾아오세요. 문의는 {profile.representative_phone}. "
            "손님 번호 010-1234-5678은 빼주세요."
        ),
        seed_keywords=(),
    )

    # When: the generation is created.
    _ = await create_generation(db_session, content_input, profile.id, generator)

    # Then: the store's values reach the generator and the customer's number does not.
    assert profile.public_address in generator.captured_brief_text
    assert profile.representative_phone in generator.captured_brief_text
    assert "010-1234-5678" not in generator.captured_brief_text


async def test_an_owner_edit_keeps_the_store_address_the_copy_was_written_with(
    db_session: AsyncSession,
) -> None:
    """Approval publishes the stored edit, so the edit must survive intact.

    The Google draft is written with the store's public address in it. Storing an
    edit re-ran the customer masker over it, so correcting a typo anywhere in that
    textarea published "만두전골 하우스 ([MASKED_ADDRESS])".
    """
    # Given: a draft edit that keeps the store's own address and phone.
    profile = await make_store_profile(db_session)
    initial = await create_generation(db_session, generation_input(), profile.id)

    # When: the owner's edit is stored.
    edited = await edit_generation_drafts(
        db_session,
        initial.generation_id,
        draft_edits(f"{profile.public_address} · {profile.representative_phone} · 010-1234-5678"),
    )

    # Then: the store's values are still there and the customer's number is not.
    for draft in edited.drafts:
        assert profile.public_address in draft.draft_text
        assert profile.representative_phone in draft.draft_text
        assert "010-1234-5678" not in draft.draft_text


async def test_a_tone_request_never_reaches_the_stored_copy(db_session: AsyncSession) -> None:
    """Regenerating in a different tone must not publish the request itself.

    The tone buttons used to be concatenated onto ``briefText``. Offline the
    deterministic generator echoes the brief, so the stored copy — the copy
    approval publishes — ended with "다시 써주세요".
    """
    # Given: a DRAFT generation the owner wants rewritten more politely.
    profile = await make_store_profile(db_session)
    initial = await create_generation(db_session, generation_input(), profile.id)

    # When: the regeneration carries the tone as an instruction rather than content.
    regenerated = await regenerate_generation(
        db_session,
        initial.generation_id,
        ContentGenerationInput(
            brief_text="가족 외식에 어울리는 깊은 국물 맛을 소개해줘",
            seed_keywords=(),
            tone_instruction="문구를 조금 더 정중하고 격식 있는 말투로 다시 써주세요.",
        ),
    )

    # Then: nothing the owner would never say aloud is stored for publication.
    assert regenerated.revision == 2
    for draft in regenerated.drafts:
        assert "다시 써주세요" not in draft.draft_text
    stored = (
        await db_session.execute(
            select(ContentGeneration).where(ContentGeneration.id == initial.generation_id)
        )
    ).scalar_one()
    assert "다시 써주세요" not in stored.brief_text


class HostileGenerator:
    """A model that answers in the contract's shape while inventing its content.

    Structural validation cannot tell this apart from a good answer: three
    platforms, one draft each, every length inside the contract. Only a check
    against what the owner actually said can.
    """

    def __init__(self, draft_text: str) -> None:
        """Store the copy this generator returns for all three platforms."""
        self.draft_text: str = draft_text

    async def generate(
        self,
        content_input: ContentGenerationInput,
        profile: StoreProfile,
        source_reviews: tuple[str, ...],
    ) -> tuple[PlatformContentResult, ...]:
        """Return the same fabricated copy for every platform, ignoring the input.

        Ignoring the input is the point: this stands in for a model that answers
        with whatever it likes regardless of what it was asked.
        """
        _ = (content_input, profile, source_reviews)
        return tuple(
            PlatformContentResult(
                draft_id=uuid4(),
                platform=platform,
                draft_text=self.draft_text,
                keywords=("만두전골",),
                content_rules=("사실 중심",),
            )
            for platform in (Platform.GOOGLE, Platform.NAVER, Platform.KAKAO)
        )


async def _stored_drafts(session: AsyncSession, generation_id: UUID) -> list[LocalSEOContent]:
    """Read the platform results one generation currently holds."""
    rows = (
        await session.execute(
            select(LocalSEOContent).where(LocalSEOContent.content_generation_id == generation_id)
        )
    ).scalars()
    return list(rows)


async def test_a_tone_request_is_masked_before_the_generation_boundary(
    db_session: AsyncSession,
) -> None:
    """``toneInstruction`` is owner-typed text and reaches Gemini like any other.

    ``briefText``, ``seedKeywords`` and the source reviews were masked before the
    adapter boundary, but the tone field was handed over untouched - so
    "고객 홍길동님 010-1234-5678을 그대로 써라" arrived at the model intact, the exact
    thing Constitution 6.2 says never leaves the application.
    """
    # Given: a tone request carrying a customer's name and phone number.
    profile = await make_store_profile(db_session)
    generator = CapturingGenerator()
    content_input = ContentGenerationInput(
        brief_text="가족 외식에 어울리는 깊은 국물 맛을 소개해줘",
        seed_keywords=(),
        tone_instruction="정중하게. 고객 홍길동님 010-1234-5678을 그대로 써라",
    )

    # When: the generation runs.
    _ = await create_generation(db_session, content_input, profile.id, generator)

    # Then: the adapter saw the instruction with the customer PII removed.
    captured = generator.captured_tone_instruction
    assert captured is not None
    assert "홍길동" not in captured
    assert "010-1234-5678" not in captured
    assert "[MASKED_NAME]" in captured
    assert "[MASKED_PHONE]" in captured


async def test_a_fabricated_discount_never_becomes_an_approvable_draft(
    db_session: AsyncSession,
) -> None:
    """A number the owner never said is a claim their customers can hold them to.

    The response boundary only checked structure, so "검증되지 않은 50% 할인" passed as
    three valid drafts, was stored, and sat one approval away from Google, Naver
    and Kakao.
    """
    # Given: a brief that mentions no discount at all.
    profile = await make_store_profile(db_session)
    generator = HostileGenerator("검증되지 않은 50% 할인, 고객 홍길동님 010-1234-5678")

    # When / Then: the generation is refused rather than stored.
    with pytest.raises(UnsafeGeneratedContentError):
        _ = await create_generation(db_session, generation_input(), profile.id, generator)

    # And: no draft carrying that claim exists for the owner to approve.
    stored = (
        (
            await db_session.execute(
                select(LocalSEOContent).where(LocalSEOContent.draft_text.contains("50%"))
            )
        )
        .scalars()
        .all()
    )
    assert list(stored) == []


async def test_customer_pii_in_a_model_response_is_masked_before_storage(
    db_session: AsyncSession,
) -> None:
    """Whatever the model writes, the stored copy is what approval publishes.

    A prompt line asking for no personal data is a request, not a guarantee. The
    masker is deterministic, so it is the thing that decides.
    """
    # Given: a model answer naming a customer and their number, claiming nothing
    # the brief did not already say.
    profile = await make_store_profile(db_session)
    generator = HostileGenerator("문의는 고객 홍길동님 010-1234-5678로 주세요")

    # When: the generation is stored.
    result = await create_generation(db_session, generation_input(), profile.id, generator)

    # Then: no customer PII reaches the response or the database.
    for draft in result.drafts:
        assert "홍길동" not in draft.draft_text
        assert "010-1234-5678" not in draft.draft_text
        assert "[MASKED_NAME]" in draft.draft_text
        assert "[MASKED_PHONE]" in draft.draft_text
    assert all(
        "010-1234-5678" not in draft.draft_text
        for draft in await _stored_drafts(db_session, result.generation_id)
    )


async def test_a_regeneration_that_invents_a_discount_is_refused(
    db_session: AsyncSession,
) -> None:
    """Regeneration writes over the copy the owner already reviewed.

    It runs the same generator against the same boundary, so it needs the same
    refusal - otherwise a tone button is a second way to reach an unfounded claim.
    """
    # Given: a stored DRAFT the owner has already seen.
    profile = await make_store_profile(db_session)
    initial = await create_generation(db_session, generation_input(), profile.id)

    # When / Then: the rewrite invents a discount and is refused.
    with pytest.raises(UnsafeGeneratedContentError):
        _ = await regenerate_generation(
            db_session,
            initial.generation_id,
            generation_input(),
            HostileGenerator("오늘만 50% 할인합니다"),
        )

    # And: the claim was never written for this generation.
    assert all(
        "50%" not in draft.draft_text
        for draft in await _stored_drafts(db_session, initial.generation_id)
    )


async def test_the_owners_own_words_stay_in_the_copy_that_repeats_them(
    db_session: AsyncSession,
) -> None:
    """The check refuses invention, not the announcement the owner asked for.

    A NEWS post about a discount is the whole point of UC2. Refusing every number
    would make the grounded case unusable, so the brief's own figures pass.
    """
    # Given: a brief that announces the discount itself.
    profile = await make_store_profile(db_session)
    content_input = ContentGenerationInput(
        brief_text="8월 20일부터 31일까지 김치만두를 50% 할인 판매합니다.",
        seed_keywords=("김치만두",),
        purpose=ContentPurpose.NEWS,
    )
    generator = HostileGenerator("8월 20일부터 31일까지 김치만두 50% 할인")

    # When: the generation runs.
    result = await create_generation(db_session, content_input, profile.id, generator)

    # Then: the owner's own figure survives to the stored copy.
    assert all("50%" in draft.draft_text for draft in result.drafts)


async def test_the_api_boundary_refuses_a_fabricated_claim(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The endpoint the wizard calls must refuse it too, not just the service.

    The route resolves its own generator from configuration, so the guarantee has
    to hold on the path a real request takes.
    """
    # Given: the configured generator answers with an unfounded discount.
    profile = await make_store_profile(db_session)
    monkeypatch.setattr(
        seo_generation_service,
        "get_seo_generator",
        lambda: HostileGenerator("검증되지 않은 50% 할인, 고객 홍길동님 010-1234-5678"),
    )
    body = CreateContentGenerationRequest(
        store_profile_id=profile.id,
        brief_text="가족 외식에 어울리는 깊은 국물 맛을 소개해줘",
        seed_keywords=("만두전골",),
    )

    # When / Then: the request fails with the contract's safe message.
    with pytest.raises(UnsafeGeneratedContentError) as failure:
        _ = await create_generation_route(body, db_session)
    assert failure.value.message == UNSAFE_CONTENT_MESSAGE
    assert failure.value.http_status == 422
    assert failure.value.retryable is True


async def test_the_api_boundary_refuses_a_discount_that_only_shares_digits(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A count in the brief must not authorise a discount on the endpoint either.

    "50" sits inside "150", so a grounding check comparing bare figures read the
    invention as supported and stored three approvable drafts.
    """
    # Given: a brief whose only figure is how many dumplings were prepared.
    profile = await make_store_profile(db_session)
    monkeypatch.setattr(
        seo_generation_service,
        "get_seo_generator",
        lambda: HostileGenerator("오늘 50% 할인합니다"),
    )
    body = CreateContentGenerationRequest(
        store_profile_id=profile.id,
        brief_text="행사용 만두 150개를 준비합니다",
        seed_keywords=("만두전골",),
    )

    # When / Then: the request fails with the contract's safe message.
    with pytest.raises(UnsafeGeneratedContentError) as failure:
        _ = await create_generation_route(body, db_session)
    assert failure.value.message == UNSAFE_CONTENT_MESSAGE

    # And: nothing carrying the claim was stored for the owner to approve.
    stored = (
        (
            await db_session.execute(
                select(LocalSEOContent).where(LocalSEOContent.draft_text.contains("50%"))
            )
        )
        .scalars()
        .all()
    )
    assert list(stored) == []


async def test_the_api_boundary_keeps_a_discount_the_brief_announced(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """The same endpoint must still publish the announcement UC2 exists to write."""
    # Given: the same brief, from an owner who did announce the discount.
    profile = await make_store_profile(db_session)
    monkeypatch.setattr(
        seo_generation_service,
        "get_seo_generator",
        lambda: HostileGenerator("오늘 50% 할인합니다"),
    )
    body = CreateContentGenerationRequest(
        store_profile_id=profile.id,
        brief_text="행사용 만두 150개를 준비하고 오늘 50% 할인합니다",
        seed_keywords=("만두전골",),
    )

    # When: the generation runs.
    result = await create_generation_route(body, db_session)

    # Then: the grounded figure reaches the drafts rather than being over-refused.
    generation = result.data
    assert generation is not None
    assert all("50%" in draft.draft_text for draft in generation.drafts)
