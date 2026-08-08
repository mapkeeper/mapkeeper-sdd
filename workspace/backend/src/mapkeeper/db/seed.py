"""Seed the demo store so UC1 and UC2 can be shown without each other.

Run with ``uv run --locked python -m mapkeeper.db.seed`` after ``alembic upgrade head``.

The data is deliberately synthetic. It carries no customer PII, and
``platformAccountRefs`` holds only public account identifiers and secret manager
references, never an OAuth token or an API secret.
"""

import asyncio
from dataclasses import dataclass
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.json_types import JsonObject
from mapkeeper.db.session import dispose_engine, get_session_factory
from mapkeeper.models import SourceReview, StoreProfile

DEMO_STORE_PROFILE_ID: Final = UUID("11111111-1111-4111-8111-111111111111")
DEMO_SOURCE_REVIEW_IDS: Final = (
    UUID("55555555-5555-4555-8555-555555555555"),
    UUID("55555555-5555-4555-8555-555555555556"),
    UUID("55555555-5555-4555-8555-555555555557"),
)

DEMO_STORE_NAME: Final = "만두전골 하우스"
DEMO_PUBLIC_ADDRESS: Final = "서울특별시 관악구 시연로 12"
DEMO_BUSINESS_HOURS: Final[JsonObject] = {"open": "09:00", "close": "22:00"}
DEMO_MENU_NAME: Final = "만두전골"
DEMO_PHONE: Final = "02-000-0000"

# Public account ids and secret manager references only. Never a token or a secret.
DEMO_PLATFORM_ACCOUNT_REFS: Final[JsonObject] = {
    "google": {
        "locationId": "locations/0000000000000000001",
        "credentialRef": "sm://mapkeeper/google",
    },
    "naver": {"placeId": "0000000001", "credentialRef": "sm://mapkeeper/naver"},
    "kakao": {"placeId": "0000000002", "credentialRef": "sm://mapkeeper/kakao"},
}

# Already masked. The raw text never reaches the database or Gemini.
DEMO_MASKED_REVIEWS: Final[tuple[str, ...]] = (
    "[고객명]님 가족과 방문했는데 국물이 깊고 재료가 신선했어요. 주차도 편했습니다.",
    "아이와 함께 갔는데 자리가 넓어 좋았어요. 만두전골 양이 푸짐합니다.",
    "[고객명]님 일행이 예약 문의를 [전화번호]로 주셨어요. 응대가 친절했습니다.",
)


@dataclass(frozen=True)
class SeedResult:
    """What the seed had to create, so a repeated run can report doing nothing."""

    created_store_profile: bool
    created_review_count: int

    @property
    def changed(self) -> bool:
        """Return whether this run wrote anything."""
        return self.created_store_profile or self.created_review_count > 0


def build_store_profile() -> StoreProfile:
    """Return the demo store with a fixed id so the seed stays idempotent."""
    return StoreProfile(
        id=DEMO_STORE_PROFILE_ID,
        store_name=DEMO_STORE_NAME,
        public_address=DEMO_PUBLIC_ADDRESS,
        business_hours=DEMO_BUSINESS_HOURS,
        temporary_closure_start_date=None,
        temporary_closure_end_date=None,
        representative_menu_name=DEMO_MENU_NAME,
        representative_phone=DEMO_PHONE,
        platform_account_refs=DEMO_PLATFORM_ACCOUNT_REFS,
    )


def build_source_reviews() -> tuple[SourceReview, ...]:
    """Return the masked demo reviews with fixed ids so the seed stays idempotent."""
    return tuple(
        SourceReview(
            id=review_id,
            store_profile_id=DEMO_STORE_PROFILE_ID,
            body_masked=body,
        )
        for review_id, body in zip(DEMO_SOURCE_REVIEW_IDS, DEMO_MASKED_REVIEWS, strict=True)
    )


async def seed(session: AsyncSession) -> SeedResult:
    """Insert whatever the demo needs and leave anything already present untouched."""
    existing_profile = await session.get(StoreProfile, DEMO_STORE_PROFILE_ID)
    created_profile = existing_profile is None
    if created_profile:
        session.add(build_store_profile())
        await session.flush()

    present = set(
        (
            await session.execute(
                select(SourceReview.id).where(SourceReview.id.in_(DEMO_SOURCE_REVIEW_IDS))
            )
        )
        .scalars()
        .all()
    )
    missing = [review for review in build_source_reviews() if review.id not in present]
    session.add_all(missing)
    await session.flush()

    return SeedResult(created_store_profile=created_profile, created_review_count=len(missing))


async def run() -> SeedResult:
    """Seed the configured database in one committed transaction."""
    try:
        async with get_session_factory()() as session, session.begin():
            return await seed(session)
    finally:
        await dispose_engine()


def main() -> None:
    """Seed the configured database and report what changed."""
    result = asyncio.run(run())
    if not result.changed:
        print("Seed already present; nothing to do.")  # noqa: T201
        return
    summary = (
        f"Seeded store profile: {result.created_store_profile}, "
        f"masked reviews created: {result.created_review_count}."
    )
    print(summary)  # noqa: T201


if __name__ == "__main__":
    main()
