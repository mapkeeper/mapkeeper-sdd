"""Checks that PostgreSQL itself rejects the states the Data Model forbids."""

from datetime import UTC, date, datetime
from typing import Final
from uuid import UUID, uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.models import (
    ContentGeneration,
    ContentGenerationStatus,
    LocalSEOContent,
    Platform,
    PlatformSyncTask,
    PlatformSyncTaskStatus,
    ProposalStatus,
    StoreChangeProposal,
    StoreProfile,
    SyncJob,
    SyncJobStatus,
    SyncSourceType,
)

pytestmark = pytest.mark.asyncio

SELECT_PLATFORMS_SQL: Final = """
SELECT platform::text FROM local_seo_content
WHERE content_generation_id = :gid ORDER BY platform::text
"""
INSERT_UNKNOWN_PLATFORM_SQL: Final = """
INSERT INTO local_seo_content
(id, content_generation_id, platform, draft_text, keywords, content_rules)
VALUES (:id, :gid, 'GOOGLE', 'x', ARRAY['k'], '[]'::jsonb)
"""


def make_store_profile(**overrides: object) -> StoreProfile:
    """Build a valid StoreProfile carrying no PII and no secrets."""
    values: dict[str, object] = {
        "store_name": "만두전골 하우스",
        "public_address": "서울특별시 어딘가 1길 2",
        "business_hours": {"open": "09:00", "close": "22:00"},
        "representative_menu_name": "만두전골",
        "representative_phone": "02-000-0000",
        "platform_account_refs": {"google": "accounts/mvp-sample"},
    }
    values.update(overrides)
    return StoreProfile(**values)


def make_proposal(store_profile_id: UUID, **overrides: object) -> StoreChangeProposal:
    """Build a valid DRAFT proposal."""
    values: dict[str, object] = {
        "store_profile_id": store_profile_id,
        "recognized_text_masked": "영업시간을 오후 8시까지로 바꿔줘",
        "changes": [
            {
                "field": "businessHours",
                "currentValue": {"open": "09:00", "close": "22:00"},
                "proposedValue": {"open": "09:00", "close": "20:00"},
            }
        ],
        "status": ProposalStatus.DRAFT,
    }
    values.update(overrides)
    return StoreChangeProposal(**values)


def make_generation(store_profile_id: UUID, **overrides: object) -> ContentGeneration:
    """Build a valid DRAFT generation."""
    values: dict[str, object] = {
        "store_profile_id": store_profile_id,
        "brief_text": "깊은 국물 맛과 신선한 재료를 강조하고 싶어요.",
        "seed_keywords": ["만두전골", "가족외식"],
        "source_review_ids": None,
        "status": ContentGenerationStatus.DRAFT,
        "revision": 1,
    }
    values.update(overrides)
    return ContentGeneration(**values)


def make_draft(
    content_generation_id: UUID, platform: Platform, **overrides: object
) -> LocalSEOContent:
    """Build a valid platform result."""
    values: dict[str, object] = {
        "content_generation_id": content_generation_id,
        "platform": platform,
        "draft_text": f"{platform.value}용 매장 소개글",
        "keywords": ["만두전골"],
        "content_rules": [f"team-defined-{platform.value}-rule"],
    }
    values.update(overrides)
    return LocalSEOContent(**values)


def make_sync_job(store_profile_id: UUID, **overrides: object) -> SyncJob:
    """Build a valid UC1-sourced PENDING job."""
    values: dict[str, object] = {
        "store_profile_id": store_profile_id,
        "source_type": SyncSourceType.STORE_CHANGE_PROPOSAL,
        "content_generation_id": None,
        "status": SyncJobStatus.PENDING,
        "approved_at": datetime.now(UTC),
        "approved_by": uuid4(),
        "idempotency_key": f"key-{uuid4().hex}",
        "idempotency_request_hash": "a" * 64,
    }
    values.update(overrides)
    return SyncJob(**values)


def make_task(sync_job_id: UUID, platform: Platform, **overrides: object) -> PlatformSyncTask:
    """Build a valid PENDING platform task."""
    values: dict[str, object] = {
        "sync_job_id": sync_job_id,
        "platform": platform,
        "status": PlatformSyncTaskStatus.PENDING,
        "attempt_count": 0,
    }
    values.update(overrides)
    return PlatformSyncTask(**values)


async def persisted_profile(session: AsyncSession) -> StoreProfile:
    """Insert and return a valid StoreProfile."""
    profile = make_store_profile()
    session.add(profile)
    await session.flush()
    return profile


# --- StoreProfile: temporary closure -------------------------------------------------


async def test_temporary_closure_rejects_an_end_date_before_the_start_date(
    db_session: AsyncSession,
) -> None:
    # Given: a closure whose dates are reversed.
    profile = make_store_profile(
        temporary_closure_start_date=date(2026, 8, 17),
        temporary_closure_end_date=date(2026, 8, 15),
    )
    db_session.add(profile)

    # When / Then: PostgreSQL refuses the row.
    with pytest.raises(IntegrityError, match="ck_store_profile_temporary_closure_range"):
        await db_session.flush()


async def test_temporary_closure_rejects_a_start_date_without_an_end_date(
    db_session: AsyncSession,
) -> None:
    # Given: only half of the closure period.
    profile = make_store_profile(temporary_closure_start_date=date(2026, 8, 15))
    db_session.add(profile)

    # When / Then: the pair must be filled together.
    with pytest.raises(IntegrityError, match="ck_store_profile_temporary_closure_range"):
        await db_session.flush()


async def test_temporary_closure_accepts_both_dates_or_neither(db_session: AsyncSession) -> None:
    # Given: one profile with no closure and one with a valid period.
    without = make_store_profile()
    with_period = make_store_profile(
        temporary_closure_start_date=date(2026, 8, 15),
        temporary_closure_end_date=date(2026, 8, 17),
    )
    db_session.add_all([without, with_period])

    # When: both are written.
    await db_session.flush()

    # Then: a single-day closure is also valid.
    same_day = make_store_profile(
        temporary_closure_start_date=date(2026, 8, 15),
        temporary_closure_end_date=date(2026, 8, 15),
    )
    db_session.add(same_day)
    await db_session.flush()
    assert same_day.id is not None


# --- ContentGeneration and LocalSEOContent -------------------------------------------


async def test_generation_revision_cannot_start_below_one(db_session: AsyncSession) -> None:
    # Given: a generation claiming revision zero.
    profile = await persisted_profile(db_session)
    generation = make_generation(profile.id, revision=0)
    db_session.add(generation)

    # When / Then: the first revision is the lowest the database accepts.
    with pytest.raises(IntegrityError, match="ck_content_generation_positive_revision"):
        await db_session.flush()


async def test_one_generation_cannot_hold_two_results_for_one_platform(
    db_session: AsyncSession,
) -> None:
    # Given: a generation that already has a Google result.
    profile = await persisted_profile(db_session)
    generation = make_generation(profile.id)
    db_session.add(generation)
    await db_session.flush()
    db_session.add(make_draft(generation.id, Platform.GOOGLE))
    await db_session.flush()

    # When: a second Google result is added.
    db_session.add(make_draft(generation.id, Platform.GOOGLE))

    # Then: the platform is unique within the generation.
    with pytest.raises(IntegrityError, match="uq_local_seo_content_content_generation_id_platform"):
        await db_session.flush()


async def test_one_generation_holds_all_three_platforms(db_session: AsyncSession) -> None:
    # Given: a DRAFT generation.
    profile = await persisted_profile(db_session)
    generation = make_generation(profile.id)
    db_session.add(generation)
    await db_session.flush()

    # When: one result per platform is stored.
    db_session.add_all(
        [
            make_draft(generation.id, platform)
            for platform in (Platform.GOOGLE, Platform.NAVER, Platform.KAKAO)
        ]
    )
    await db_session.flush()

    # Then: all three coexist.
    stored = await db_session.execute(text(SELECT_PLATFORMS_SQL), {"gid": generation.id})
    assert [row[0] for row in stored] == ["google", "kakao", "naver"]


async def test_platform_enum_rejects_a_value_outside_the_contract(
    db_session: AsyncSession,
) -> None:
    # Given: a generation to attach a result to.
    profile = await persisted_profile(db_session)
    generation = make_generation(profile.id)
    db_session.add(generation)
    await db_session.flush()

    # When / Then: the uppercase spelling is not a member of the native enum type.
    with pytest.raises(DBAPIError, match="GOOGLE"):
        _ = await db_session.execute(
            text(INSERT_UNKNOWN_PLATFORM_SQL),
            {"id": uuid4(), "gid": generation.id},
        )


# --- SyncJob -------------------------------------------------------------------------


async def test_sync_job_rejects_two_approval_sources(db_session: AsyncSession) -> None:
    # Given: a job pointing at both a proposal and a generation.
    profile = await persisted_profile(db_session)
    proposal = make_proposal(profile.id)
    generation = make_generation(profile.id)
    db_session.add_all([proposal, generation])
    await db_session.flush()
    db_session.add(
        make_sync_job(
            profile.id,
            store_change_proposal_id=proposal.id,
            content_generation_id=generation.id,
        )
    )

    # When / Then: exactly one source is allowed.
    with pytest.raises(IntegrityError, match="ck_sync_job_source_exclusivity"):
        await db_session.flush()


async def test_sync_job_rejects_a_missing_approval_source(db_session: AsyncSession) -> None:
    # Given: a job with neither source foreign key.
    profile = await persisted_profile(db_session)
    db_session.add(make_sync_job(profile.id, store_change_proposal_id=None))

    # When / Then: a job cannot exist without the approval that created it.
    with pytest.raises(IntegrityError, match="ck_sync_job_source_exclusivity"):
        await db_session.flush()


async def test_sync_job_rejects_a_source_that_contradicts_its_source_type(
    db_session: AsyncSession,
) -> None:
    # Given: a UC1 source type carrying a UC2 foreign key.
    profile = await persisted_profile(db_session)
    generation = make_generation(profile.id)
    db_session.add(generation)
    await db_session.flush()
    db_session.add(
        make_sync_job(
            profile.id,
            source_type=SyncSourceType.STORE_CHANGE_PROPOSAL,
            store_change_proposal_id=None,
            content_generation_id=generation.id,
        )
    )

    # When / Then: sourceType and the populated foreign key must agree.
    with pytest.raises(IntegrityError, match="ck_sync_job_source_exclusivity"):
        await db_session.flush()


async def test_one_actor_cannot_reuse_an_idempotency_key(db_session: AsyncSession) -> None:
    # Given: an approval already recorded under one key.
    profile = await persisted_profile(db_session)
    proposal = make_proposal(profile.id)
    db_session.add(proposal)
    await db_session.flush()
    actor = uuid4()
    first = make_sync_job(
        profile.id,
        store_change_proposal_id=proposal.id,
        approved_by=actor,
        idempotency_key="approve-once",
    )
    db_session.add(first)
    await db_session.flush()

    # When: the same actor reuses the key for another job.
    db_session.add(
        make_sync_job(
            profile.id,
            store_change_proposal_id=proposal.id,
            approved_by=actor,
            idempotency_key="approve-once",
        )
    )

    # Then: duplicate external writes are blocked at the database.
    with pytest.raises(IntegrityError, match="uq_sync_job_approved_by_idempotency_key"):
        await db_session.flush()


async def test_two_actors_may_use_the_same_idempotency_key(db_session: AsyncSession) -> None:
    # Given: two different approvers.
    profile = await persisted_profile(db_session)
    proposal = make_proposal(profile.id)
    db_session.add(proposal)
    await db_session.flush()

    # When: both use the same key value.
    db_session.add_all(
        [
            make_sync_job(
                profile.id,
                store_change_proposal_id=proposal.id,
                approved_by=uuid4(),
                idempotency_key="shared-key",
            )
            for _ in range(2)
        ]
    )

    # Then: idempotency is scoped per actor, not globally.
    await db_session.flush()


# --- PlatformSyncTask ----------------------------------------------------------------


async def test_platform_task_attempts_are_capped_at_three(db_session: AsyncSession) -> None:
    # Given: a task claiming a fourth attempt.
    profile = await persisted_profile(db_session)
    proposal = make_proposal(profile.id)
    db_session.add(proposal)
    await db_session.flush()
    job = make_sync_job(profile.id, store_change_proposal_id=proposal.id)
    db_session.add(job)
    await db_session.flush()
    db_session.add(make_task(job.id, Platform.NAVER, attempt_count=4))

    # When / Then: retries stop at three attempts.
    with pytest.raises(IntegrityError, match="ck_platform_sync_task_attempt_count_range"):
        await db_session.flush()


async def test_one_job_cannot_run_a_platform_twice(db_session: AsyncSession) -> None:
    # Given: a job that already has a Naver task.
    profile = await persisted_profile(db_session)
    proposal = make_proposal(profile.id)
    db_session.add(proposal)
    await db_session.flush()
    job = make_sync_job(profile.id, store_change_proposal_id=proposal.id)
    db_session.add(job)
    await db_session.flush()
    db_session.add(make_task(job.id, Platform.NAVER))
    await db_session.flush()

    # When: a second Naver task is added to the same job.
    db_session.add(make_task(job.id, Platform.NAVER))

    # Then: each platform runs at most once per job.
    with pytest.raises(IntegrityError, match="uq_platform_sync_task_sync_job_id_platform"):
        await db_session.flush()


# --- Referential behaviour -----------------------------------------------------------


async def test_deleting_a_profile_removes_its_proposals(db_session: AsyncSession) -> None:
    # Given: a profile with one proposal.
    profile = await persisted_profile(db_session)
    db_session.add(make_proposal(profile.id))
    await db_session.flush()

    # When: the profile is deleted.
    _ = await db_session.execute(
        text("DELETE FROM store_profile WHERE id = :pid"), {"pid": profile.id}
    )

    # Then: the dependent proposal goes with it.
    remaining = await db_session.execute(
        text("SELECT id FROM store_change_proposal WHERE store_profile_id = :pid"),
        {"pid": profile.id},
    )
    assert list(remaining.all()) == []


async def test_an_approved_proposal_cannot_be_deleted_while_a_job_references_it(
    db_session: AsyncSession,
) -> None:
    # Given: a proposal that already produced a sync job.
    profile = await persisted_profile(db_session)
    proposal = make_proposal(profile.id, status=ProposalStatus.APPROVED)
    db_session.add(proposal)
    await db_session.flush()
    db_session.add(make_sync_job(profile.id, store_change_proposal_id=proposal.id))
    await db_session.flush()

    # When / Then: the approval history cannot be erased from under the job.
    with pytest.raises(IntegrityError, match="fk_sync_job_store_change_proposal_id"):
        _ = await db_session.execute(
            text("DELETE FROM store_change_proposal WHERE id = :pid"), {"pid": proposal.id}
        )


# --- Server-managed columns ----------------------------------------------------------


async def test_timestamps_are_filled_by_the_database(db_session: AsyncSession) -> None:
    # Given: a profile inserted without any timestamp values.
    profile = await persisted_profile(db_session)

    # When: the stored row is read back.
    await db_session.refresh(profile)

    # Then: PostgreSQL supplied both timestamps with a timezone.
    assert profile.created_at.tzinfo is not None
    assert profile.updated_at.tzinfo is not None
