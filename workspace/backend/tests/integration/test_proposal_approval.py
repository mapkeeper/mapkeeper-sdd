"""T220 against live PostgreSQL: UC1 approval is one atomic transaction."""

from datetime import date
from typing import TYPE_CHECKING, Final
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.errors import (
    IdempotencyConflictError,
    InvalidStateError,
    ResourceNotFoundError,
)
from mapkeeper.models import (
    Platform,
    PlatformSyncTask,
    PlatformSyncTaskStatus,
    ProposalStatus,
    StoreProfile,
    SyncJob,
    SyncJobStatus,
    SyncSourceType,
)
from mapkeeper.services.approval import SYNCED_PLATFORMS
from mapkeeper.services.proposal_approval import approve_proposal

from .factories import (
    BUSINESS_HOURS_CHANGE,
    MENU_NAME_CHANGE,
    PARKING_INFO_CHANGE,
    TEMPORARY_CLOSURE_CHANGE,
    make_proposal,
    make_store_profile,
)

pytestmark = pytest.mark.asyncio

if TYPE_CHECKING:
    from mapkeeper.core.json_types import JsonValue

KEY: Final = "approve-uc1"


async def test_approving_a_draft_writes_every_record_together(db_session: AsyncSession) -> None:
    # Given: a DRAFT proposal shortening the closing time.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id)

    # When: it is approved.
    result = await approve_proposal(db_session, proposal.id, uuid4(), KEY)

    # Then: proposal, profile, job and three platform tasks all exist at once.
    assert result.replayed is False
    assert proposal.status is ProposalStatus.APPROVED
    assert proposal.approved_at is not None
    assert profile.business_hours == {"open": "09:00", "close": "20:00"}
    assert result.sync_job.status is SyncJobStatus.PENDING
    assert result.sync_job.source_type is SyncSourceType.STORE_CHANGE_PROPOSAL
    assert result.sync_job.store_change_proposal_id == proposal.id
    assert result.sync_job.content_generation_id is None


async def test_approval_creates_exactly_one_task_per_platform(db_session: AsyncSession) -> None:
    # Given: an approved proposal.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id)
    result = await approve_proposal(db_session, proposal.id, uuid4(), KEY)

    # When: the job's platform tasks are read back.
    tasks = (
        (
            await db_session.execute(
                select(PlatformSyncTask).where(PlatformSyncTask.sync_job_id == result.sync_job.id)
            )
        )
        .scalars()
        .all()
    )

    # Then: all three platforms start PENDING with no attempt yet.
    assert {task.platform for task in tasks} == set(SYNCED_PLATFORMS)
    assert all(task.status is PlatformSyncTaskStatus.PENDING for task in tasks)
    assert all(task.attempt_count == 0 for task in tasks)


async def test_an_empty_proposal_cannot_be_approved_or_create_a_sync_job(
    db_session: AsyncSession,
) -> None:
    # Given: a DRAFT proposal whose parser produced no supported change.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id, changes=[])

    # When / Then: approval is refused before the profile or job is changed.
    with pytest.raises(InvalidStateError, match="변경할 내용이 없는"):
        _ = await approve_proposal(db_session, proposal.id, uuid4(), "empty-proposal")

    assert proposal.status is ProposalStatus.DRAFT
    assert proposal.approved_at is None
    jobs = await db_session.scalar(
        select(func.count())
        .select_from(SyncJob)
        .where(SyncJob.store_change_proposal_id == proposal.id)
    )
    assert jobs == 0


async def test_an_unchanged_menu_cannot_be_approved_or_create_a_sync_job(
    db_session: AsyncSession,
) -> None:
    # Given: a DRAFT proposal whose menu target is already the current value.
    profile = await make_store_profile(db_session)
    unchanged_menu: list[JsonValue] = [
        {
            "field": "representativeMenuName",
            "currentValue": "만두전골",
            "proposedValue": "만두전골",
        }
    ]
    proposal = await make_proposal(db_session, profile.id, changes=unchanged_menu)

    # When / Then: approval is refused without creating a synchronization job.
    with pytest.raises(InvalidStateError, match="달라진 내용이 없어"):
        _ = await approve_proposal(db_session, proposal.id, uuid4(), "unchanged-menu")

    assert proposal.status is ProposalStatus.DRAFT
    jobs = await db_session.scalar(
        select(func.count())
        .select_from(SyncJob)
        .where(SyncJob.store_change_proposal_id == proposal.id)
    )
    assert jobs == 0


async def test_a_temporary_closure_reaches_the_store_profile(db_session: AsyncSession) -> None:
    # Given: a proposal adding a closure period.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id, TEMPORARY_CLOSURE_CHANGE)

    # When: it is approved.
    _ = await approve_proposal(db_session, proposal.id, uuid4(), KEY)

    # Then: both dates land together, which is what the check constraint demands.
    assert profile.temporary_closure_start_date == date(2026, 8, 15)
    assert profile.temporary_closure_end_date == date(2026, 8, 17)


async def test_a_menu_rename_reaches_the_store_profile(db_session: AsyncSession) -> None:
    # Given: a proposal renaming the representative menu.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id, MENU_NAME_CHANGE)

    # When: it is approved.
    _ = await approve_proposal(db_session, proposal.id, uuid4(), KEY)

    # Then: the approved target state is stored.
    assert profile.representative_menu_name == "수제 바닐라라테"


async def test_a_parking_info_update_reaches_the_store_profile(db_session: AsyncSession) -> None:
    # Given: a proposal setting parking info on a profile that has none yet.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id, PARKING_INFO_CHANGE)

    # When: it is approved.
    _ = await approve_proposal(db_session, proposal.id, uuid4(), KEY)

    # Then: the approved target state is stored.
    assert profile.parking_info == "건물 뒤 3대 가능"


async def test_an_unknown_proposal_is_reported_as_missing(db_session: AsyncSession) -> None:
    # Given: an id that belongs to no proposal.

    # When / Then: the caller sees 404 rather than a database error.
    with pytest.raises(ResourceNotFoundError):
        _ = await approve_proposal(db_session, uuid4(), uuid4(), KEY)


@pytest.mark.parametrize("status", [ProposalStatus.APPROVED, ProposalStatus.REJECTED])
async def test_only_a_draft_can_be_approved(
    db_session: AsyncSession,
    status: ProposalStatus,
) -> None:
    # Given: a proposal that was already decided.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id, status=status)

    # When / Then: a fresh key cannot approve it a second time.
    with pytest.raises(InvalidStateError):
        _ = await approve_proposal(db_session, proposal.id, uuid4(), "fresh-key")


async def test_repeating_the_same_approval_returns_the_first_job(
    db_session: AsyncSession,
) -> None:
    # Given: an approval that already ran.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id)
    actor = uuid4()
    first = await approve_proposal(db_session, proposal.id, actor, KEY)

    # When: the client retries the identical request.
    second = await approve_proposal(db_session, proposal.id, actor, KEY)

    # Then: the platforms are never queued twice.
    assert second.replayed is True
    assert second.sync_job.id == first.sync_job.id


async def test_a_replay_does_not_create_a_second_job(db_session: AsyncSession) -> None:
    # Given: an approval retried twice.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id)
    actor = uuid4()
    _ = await approve_proposal(db_session, proposal.id, actor, KEY)
    _ = await approve_proposal(db_session, proposal.id, actor, KEY)

    # When: the jobs of this actor are counted.
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


async def test_reusing_a_key_for_another_proposal_is_a_conflict(
    db_session: AsyncSession,
) -> None:
    # Given: a key already used to approve one proposal.
    profile = await make_store_profile(db_session)
    first = await make_proposal(db_session, profile.id)
    actor = uuid4()
    _ = await approve_proposal(db_session, first.id, actor, KEY)

    # When: the same key is sent for a different proposal.
    second = await make_proposal(db_session, profile.id, MENU_NAME_CHANGE)

    # Then: the second approval is refused instead of replayed.
    with pytest.raises(IdempotencyConflictError):
        _ = await approve_proposal(db_session, second.id, actor, KEY)


async def test_a_failure_after_the_profile_update_rolls_everything_back(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: an approval that will break while queueing the platform tasks, which
    # happens after the proposal and the store profile have already been changed.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id)
    actor = uuid4()
    original_hours = dict(profile.business_hours)

    def over_the_retry_limit(sync_job_id: UUID) -> list[PlatformSyncTask]:
        return [
            PlatformSyncTask(
                sync_job_id=sync_job_id,
                platform=Platform.GOOGLE,
                status=PlatformSyncTaskStatus.PENDING,
                attempt_count=99,
            )
        ]

    monkeypatch.setattr("mapkeeper.services.approval.build_platform_tasks", over_the_retry_limit)

    async def attempt_approval() -> None:
        async with db_session.begin_nested():
            _ = await approve_proposal(db_session, proposal.id, actor, KEY)

    # When: the caller's transaction is rolled back after the failure.
    with pytest.raises(IntegrityError):
        await attempt_approval()

    # Then: none of the earlier steps survived.
    await db_session.refresh(profile)
    await db_session.refresh(proposal)
    jobs = await db_session.scalar(
        select(func.count()).select_from(SyncJob).where(SyncJob.approved_by == actor)
    )
    assert profile.business_hours == original_hours
    assert proposal.status is ProposalStatus.DRAFT
    assert proposal.approved_at is None
    assert jobs == 0


async def test_the_store_profile_is_untouched_when_approval_is_refused(
    db_session: AsyncSession,
) -> None:
    # Given: an already rejected proposal that would have changed the hours.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(
        db_session, profile.id, BUSINESS_HOURS_CHANGE, ProposalStatus.REJECTED
    )
    original = dict(profile.business_hours)

    # When: approving it is refused.
    with pytest.raises(InvalidStateError):
        _ = await approve_proposal(db_session, proposal.id, uuid4(), KEY)

    # Then: the target state never moved.
    stored = await db_session.get(StoreProfile, profile.id)
    assert stored is not None
    assert stored.business_hours == original


async def test_one_proposal_can_change_several_fields_at_once(db_session: AsyncSession) -> None:
    # Given: a proposal changing the hours and the menu name together.
    profile = await make_store_profile(db_session)
    combined = [*BUSINESS_HOURS_CHANGE, *MENU_NAME_CHANGE]
    proposal = await make_proposal(db_session, profile.id, combined)

    # When: it is approved.
    _ = await approve_proposal(db_session, proposal.id, uuid4(), KEY)

    # Then: every approved change reaches the target state.
    assert profile.business_hours == {"open": "09:00", "close": "20:00"}
    assert profile.representative_menu_name == "수제 바닐라라테"


async def test_a_proposal_without_its_store_is_reported_as_missing(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: a proposal whose store profile cannot be loaded.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id)

    async def no_profile(*_args: object, **_kwargs: object) -> None:
        return None

    monkeypatch.setattr(db_session, "get", no_profile)

    # When / Then: the caller sees 404 rather than a crash while applying changes.
    with pytest.raises(ResourceNotFoundError):
        _ = await approve_proposal(db_session, proposal.id, uuid4(), KEY)


async def test_a_closure_followed_by_another_change_applies_both(
    db_session: AsyncSession,
) -> None:
    # Given: a proposal whose closure change is not the last one in the list.
    profile = await make_store_profile(db_session)
    combined = [*TEMPORARY_CLOSURE_CHANGE, *MENU_NAME_CHANGE]
    proposal = await make_proposal(db_session, profile.id, combined)

    # When: it is approved.
    _ = await approve_proposal(db_session, proposal.id, uuid4(), KEY)

    # Then: applying one change never stops the rest from being applied.
    assert profile.temporary_closure_start_date == date(2026, 8, 15)
    assert profile.representative_menu_name == "수제 바닐라라테"
