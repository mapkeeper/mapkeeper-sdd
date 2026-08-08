"""Valid rows the approval checks build on."""

from typing import Final
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.json_types import JsonValue
from mapkeeper.models import (
    ContentGeneration,
    ContentGenerationStatus,
    LocalSEOContent,
    Platform,
    ProposalStatus,
    StoreChangeProposal,
    StoreProfile,
)

BUSINESS_HOURS_CHANGE: Final[list[JsonValue]] = [
    {
        "field": "businessHours",
        "currentValue": {"open": "09:00", "close": "22:00"},
        "proposedValue": {"open": "09:00", "close": "20:00"},
    }
]
TEMPORARY_CLOSURE_CHANGE: Final[list[JsonValue]] = [
    {
        "field": "temporaryClosure",
        "currentValue": None,
        "proposedValue": {"startDate": "2026-08-15", "endDate": "2026-08-17"},
    }
]
MENU_NAME_CHANGE: Final[list[JsonValue]] = [
    {
        "field": "representativeMenuName",
        "currentValue": "만두전골",
        "proposedValue": "수제 바닐라라테",
    }
]


async def make_store_profile(session: AsyncSession) -> StoreProfile:
    """Insert a store open 09:00 to 22:00 with no temporary closure."""
    profile = StoreProfile(
        store_name="만두전골 하우스",
        public_address="서울특별시 어딘가 1길 2",
        business_hours={"open": "09:00", "close": "22:00"},
        representative_menu_name="만두전골",
        representative_phone="02-000-0000",
        platform_account_refs={},
    )
    session.add(profile)
    await session.flush()
    return profile


async def make_proposal(
    session: AsyncSession,
    store_profile_id: UUID,
    changes: JsonValue = BUSINESS_HOURS_CHANGE,
    status: ProposalStatus = ProposalStatus.DRAFT,
) -> StoreChangeProposal:
    """Insert a proposal in the requested state."""
    proposal = StoreChangeProposal(
        store_profile_id=store_profile_id,
        recognized_text_masked="영업시간을 오후 8시까지로 바꿔줘",
        changes=changes,
        status=status,
    )
    session.add(proposal)
    await session.flush()
    return proposal


async def make_generation(
    session: AsyncSession,
    store_profile_id: UUID,
    status: ContentGenerationStatus = ContentGenerationStatus.DRAFT,
    revision: int = 1,
    platforms: tuple[Platform, ...] = (Platform.GOOGLE, Platform.NAVER, Platform.KAKAO),
) -> ContentGeneration:
    """Insert a generation with one result for each requested platform."""
    generation = ContentGeneration(
        store_profile_id=store_profile_id,
        brief_text="깊은 국물 맛과 신선한 재료를 강조하고 싶어요.",
        seed_keywords=["만두전골", "가족외식"],
        source_review_ids=None,
        status=status,
        revision=revision,
    )
    session.add(generation)
    await session.flush()
    session.add_all(
        LocalSEOContent(
            content_generation_id=generation.id,
            platform=platform,
            draft_text=f"{platform.value}용 매장 소개글",
            keywords=["만두전골"],
            content_rules=[f"team-defined-{platform.value}-rule"],
        )
        for platform in platforms
    )
    await session.flush()
    return generation
