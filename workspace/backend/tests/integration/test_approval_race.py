"""What happens when two approvals reach the same Idempotency-Key at once.

The pre-check cannot lock a row that does not exist yet, so the unique constraint is
what actually decides the race. These checks simulate losing it by making the
pre-check report the key as unused while a job for it already exists.
"""

from typing import Final
from uuid import UUID, uuid4

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.errors import IdempotencyConflictError
from mapkeeper.models import SyncJob, SyncSourceType
from mapkeeper.services.approval import ApprovalRequest, ApprovalSource, create_sync_job
from mapkeeper.services.idempotency import proposal_request_hash
from mapkeeper.services.proposal_approval import approve_proposal

from .factories import MENU_NAME_CHANGE, make_proposal, make_store_profile

pytestmark = pytest.mark.asyncio

KEY: Final = "race-key"


async def _pretend_key_is_unused(
    _session: AsyncSession,
    _approved_by: UUID,
    _idempotency_key: str,
    _request_hash: str,
    *,
    lock: bool = True,
) -> SyncJob | None:
    """Stand in for the pre-check so the insert races into the unique constraint."""
    _ = lock
    return None


async def test_losing_the_race_with_the_same_request_replays_the_winner(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: another transaction already created the job for this key.
    profile = await make_store_profile(db_session)
    proposal = await make_proposal(db_session, profile.id)
    actor = uuid4()
    request_hash = proposal_request_hash(proposal.id, proposal.changes)
    winner = await create_sync_job(
        db_session,
        ApprovalSource(
            store_profile_id=profile.id,
            source_type=SyncSourceType.STORE_CHANGE_PROPOSAL,
            store_change_proposal_id=proposal.id,
        ),
        ApprovalRequest(actor, KEY, request_hash),
    )

    # When: this approval's pre-check misses it and the insert loses the race.
    monkeypatch.setattr(
        "mapkeeper.services.proposal_approval.find_replayable_job",
        _pretend_key_is_unused,
    )
    result = await approve_proposal(db_session, proposal.id, actor, KEY)

    # Then: the winner's job is returned rather than a duplicate being created.
    assert result.replayed is True
    assert result.sync_job.id == winner.sync_job.id
    jobs = await db_session.scalar(
        select(func.count()).select_from(SyncJob).where(SyncJob.approved_by == actor)
    )
    assert jobs == 1


async def test_losing_the_race_with_a_different_request_is_a_conflict(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: the key already belongs to a different approval.
    profile = await make_store_profile(db_session)
    first = await make_proposal(db_session, profile.id)
    second = await make_proposal(db_session, profile.id, MENU_NAME_CHANGE)
    actor = uuid4()
    _ = await approve_proposal(db_session, first.id, actor, KEY)

    # When: another approval's pre-check misses the key and races the insert.
    monkeypatch.setattr(
        "mapkeeper.services.proposal_approval.find_replayable_job",
        _pretend_key_is_unused,
    )

    # Then: the unique constraint turns the race into the documented conflict.
    with pytest.raises(IdempotencyConflictError):
        _ = await approve_proposal(db_session, second.id, actor, KEY)


async def test_a_failure_that_is_not_an_idempotency_clash_is_reported_as_is(
    db_session: AsyncSession,
) -> None:
    # Given: a job pointing at a store profile that does not exist.
    actor = uuid4()
    source = ApprovalSource(
        store_profile_id=uuid4(),
        source_type=SyncSourceType.STORE_CHANGE_PROPOSAL,
        store_change_proposal_id=None,
    )

    # When / Then: the integrity failure surfaces instead of being mistaken for a replay.
    with pytest.raises(IntegrityError):
        _ = await create_sync_job(
            db_session, source, ApprovalRequest(actor, "orphan-key", "a" * 64)
        )
