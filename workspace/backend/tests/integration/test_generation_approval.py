"""T221 against live PostgreSQL: UC2 approves the whole generation atomically."""

from typing import Final
from uuid import uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.errors import (
    IdempotencyConflictError,
    InvalidStateError,
    ResourceNotFoundError,
)
from mapkeeper.models import (
    ContentGenerationStatus,
    Platform,
    PlatformSyncTask,
    PlatformSyncTaskStatus,
    SyncJob,
    SyncJobStatus,
    SyncSourceType,
)
from mapkeeper.services.approval import SYNCED_PLATFORMS
from mapkeeper.services.generation_approval import approve_generation

from .factories import make_generation, make_store_profile

pytestmark = pytest.mark.asyncio

KEY: Final = "approve-uc2"


async def test_approving_a_draft_generation_writes_everything_together(
    db_session: AsyncSession,
) -> None:
    # Given: a DRAFT generation holding all three platform results.
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id)

    # When: the whole generation is approved.
    result = await approve_generation(db_session, generation.id, uuid4(), KEY)

    # Then: the generation and its job are recorded in one go.
    assert result.replayed is False
    assert generation.status is ContentGenerationStatus.APPROVED
    assert generation.approved_at is not None
    assert result.sync_job.status is SyncJobStatus.PENDING
    assert result.sync_job.source_type is SyncSourceType.CONTENT_GENERATION
    assert result.sync_job.content_generation_id == generation.id
    assert result.sync_job.store_change_proposal_id is None


async def test_approval_queues_all_three_platforms(db_session: AsyncSession) -> None:
    # Given: an approved generation.
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id)
    result = await approve_generation(db_session, generation.id, uuid4(), KEY)

    # When: its platform tasks are read back.
    tasks = (
        (
            await db_session.execute(
                select(PlatformSyncTask).where(PlatformSyncTask.sync_job_id == result.sync_job.id)
            )
        )
        .scalars()
        .all()
    )

    # Then: approving the generation queues every platform, with no per-draft choice.
    assert {task.platform for task in tasks} == set(SYNCED_PLATFORMS)
    assert all(task.status is PlatformSyncTaskStatus.PENDING for task in tasks)


async def test_an_unknown_generation_is_reported_as_missing(db_session: AsyncSession) -> None:
    # Given: an id that belongs to no generation.

    # When / Then: the caller sees 404 rather than a database error.
    with pytest.raises(ResourceNotFoundError):
        _ = await approve_generation(db_session, uuid4(), uuid4(), KEY)


@pytest.mark.parametrize(
    "status",
    [ContentGenerationStatus.APPROVED, ContentGenerationStatus.REJECTED],
)
async def test_only_a_draft_generation_can_be_approved(
    db_session: AsyncSession,
    status: ContentGenerationStatus,
) -> None:
    # Given: a generation that was already decided.
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id, status=status)

    # When / Then: a fresh key cannot approve it a second time.
    with pytest.raises(InvalidStateError):
        _ = await approve_generation(db_session, generation.id, uuid4(), "fresh-key")


async def test_a_generation_missing_a_platform_result_cannot_be_approved(
    db_session: AsyncSession,
) -> None:
    # Given: a generation that only produced two of the three results.
    profile = await make_store_profile(db_session)
    generation = await make_generation(
        db_session,
        profile.id,
        platforms=(Platform.GOOGLE, Platform.NAVER),
    )

    # When / Then: approving all three would not be equivalent, so it is refused.
    with pytest.raises(InvalidStateError):
        _ = await approve_generation(db_session, generation.id, uuid4(), KEY)


async def test_a_refused_generation_stays_a_draft(db_session: AsyncSession) -> None:
    # Given: an incomplete generation.
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id, platforms=(Platform.GOOGLE,))

    # When: approval is refused.
    with pytest.raises(InvalidStateError):
        _ = await approve_generation(db_session, generation.id, uuid4(), KEY)

    # Then: the user can still regenerate or reject it.
    assert generation.status is ContentGenerationStatus.DRAFT
    assert generation.approved_at is None


async def test_repeating_the_same_approval_returns_the_first_job(
    db_session: AsyncSession,
) -> None:
    # Given: a generation already approved.
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id)
    actor = uuid4()
    first = await approve_generation(db_session, generation.id, actor, KEY)

    # When: the client retries the identical request.
    second = await approve_generation(db_session, generation.id, actor, KEY)

    # Then: the platforms are never queued twice.
    assert second.replayed is True
    assert second.sync_job.id == first.sync_job.id


async def test_a_replay_does_not_create_a_second_job(db_session: AsyncSession) -> None:
    # Given: an approval retried twice.
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id)
    actor = uuid4()
    _ = await approve_generation(db_session, generation.id, actor, KEY)
    _ = await approve_generation(db_session, generation.id, actor, KEY)

    # When: this actor's jobs and tasks are counted.
    jobs = await db_session.scalar(
        select(func.count()).select_from(SyncJob).where(SyncJob.approved_by == actor)
    )
    tasks = await db_session.scalar(
        select(func.count())
        .select_from(PlatformSyncTask)
        .join(SyncJob, SyncJob.id == PlatformSyncTask.sync_job_id)
        .where(SyncJob.approved_by == actor)
    )

    # Then: exactly one job and three tasks exist.
    assert jobs == 1
    assert tasks == len(SYNCED_PLATFORMS)


async def test_reusing_a_key_for_another_generation_is_a_conflict(
    db_session: AsyncSession,
) -> None:
    # Given: a key already used to approve one generation.
    profile = await make_store_profile(db_session)
    first = await make_generation(db_session, profile.id)
    actor = uuid4()
    _ = await approve_generation(db_session, first.id, actor, KEY)

    # When: the same key is sent for a different generation.
    second = await make_generation(db_session, profile.id)

    # Then: the second approval is refused instead of replayed.
    with pytest.raises(IdempotencyConflictError):
        _ = await approve_generation(db_session, second.id, actor, KEY)


async def test_approving_a_regenerated_result_under_the_old_key_is_a_conflict(
    db_session: AsyncSession,
) -> None:
    # Given: a generation approved at revision 1 under a key.
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id, revision=1)
    actor = uuid4()
    _ = await approve_generation(db_session, generation.id, actor, KEY)

    # When: a later revision of a different generation reuses the key.
    regenerated = await make_generation(db_session, profile.id, revision=2)

    # Then: newer copy is not approved under the key that approved the old one.
    with pytest.raises(IdempotencyConflictError):
        _ = await approve_generation(db_session, regenerated.id, actor, KEY)


async def test_a_refused_approval_leaves_no_job_behind(db_session: AsyncSession) -> None:
    # Given: a generation that cannot be approved.
    profile = await make_store_profile(db_session)
    generation = await make_generation(db_session, profile.id, platforms=(Platform.KAKAO,))
    actor = uuid4()

    # When: the approval fails.
    with pytest.raises(InvalidStateError):
        _ = await approve_generation(db_session, generation.id, actor, KEY)

    # Then: no partial job or task survives the attempt.
    jobs = await db_session.scalar(
        select(func.count()).select_from(SyncJob).where(SyncJob.approved_by == actor)
    )
    assert jobs == 0
