"""Checks that the seed actually lands in PostgreSQL and can be re-run safely."""

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.db.seed import (
    DEMO_SOURCE_REVIEW_IDS,
    DEMO_STORE_PROFILE_ID,
    seed,
)
from mapkeeper.models import SourceReview, StoreProfile

pytestmark = pytest.mark.asyncio


async def test_seeding_an_empty_database_creates_the_demo_store(
    db_session: AsyncSession,
) -> None:
    # Given: a database with no demo data in this transaction.

    # When: the seed runs.
    result = await seed(db_session)

    # Then: it reports creating the store and every masked review.
    assert result.created_store_profile is True
    assert result.created_review_count == len(DEMO_SOURCE_REVIEW_IDS)
    assert result.changed is True


async def test_the_seeded_store_satisfies_every_database_constraint(
    db_session: AsyncSession,
) -> None:
    # Given: a seeded database.
    _ = await seed(db_session)

    # When: the store is read back.
    profile = await db_session.get(StoreProfile, DEMO_STORE_PROFILE_ID)

    # Then: PostgreSQL accepted it, including the temporary closure check.
    assert profile is not None
    assert profile.temporary_closure_start_date is None
    assert profile.temporary_closure_end_date is None
    assert profile.created_at.tzinfo is not None


async def test_seeded_reviews_are_linked_to_the_seeded_store(db_session: AsyncSession) -> None:
    # Given: a seeded database.
    _ = await seed(db_session)

    # When: the reviews of the demo store are counted.
    count = await db_session.scalar(
        select(func.count())
        .select_from(SourceReview)
        .where(SourceReview.store_profile_id == DEMO_STORE_PROFILE_ID)
    )

    # Then: UC2 has masked reviews it may reference.
    assert count == len(DEMO_SOURCE_REVIEW_IDS)


async def test_running_the_seed_twice_writes_nothing_the_second_time(
    db_session: AsyncSession,
) -> None:
    # Given: an already seeded database.
    _ = await seed(db_session)

    # When: the seed runs again.
    second = await seed(db_session)

    # Then: it is safe to re-run against a live demo database.
    assert second.created_store_profile is False
    assert second.created_review_count == 0
    assert second.changed is False


async def test_the_seed_does_not_duplicate_rows_when_re_run(db_session: AsyncSession) -> None:
    # Given: a database seeded twice.
    _ = await seed(db_session)
    _ = await seed(db_session)

    # When: the demo rows are counted.
    profiles = await db_session.scalar(
        select(func.count())
        .select_from(StoreProfile)
        .where(StoreProfile.id == DEMO_STORE_PROFILE_ID)
    )
    reviews = await db_session.scalar(
        select(func.count())
        .select_from(SourceReview)
        .where(SourceReview.id.in_(DEMO_SOURCE_REVIEW_IDS))
    )

    # Then: exactly one copy of each demo row exists.
    assert profiles == 1
    assert reviews == len(DEMO_SOURCE_REVIEW_IDS)


async def test_deleting_the_demo_store_removes_its_masked_reviews(
    db_session: AsyncSession,
) -> None:
    # Given: a seeded database.
    _ = await seed(db_session)
    profile = await db_session.get(StoreProfile, DEMO_STORE_PROFILE_ID)
    assert profile is not None

    # When: the demo store is deleted.
    await db_session.delete(profile)
    await db_session.flush()

    # Then: no orphaned review text is left behind.
    remaining = await db_session.scalar(
        select(func.count())
        .select_from(SourceReview)
        .where(SourceReview.id.in_(DEMO_SOURCE_REVIEW_IDS))
    )
    assert remaining == 0
