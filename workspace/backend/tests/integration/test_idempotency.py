"""T219 against live PostgreSQL: the same request replays, a reused key is refused."""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final
from uuid import UUID, uuid4

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.errors import IdempotencyConflictError
from mapkeeper.core.json_types import JsonValue
from mapkeeper.models import (
    ProposalStatus,
    StoreChangeProposal,
    StoreProfile,
    SyncJob,
    SyncJobStatus,
    SyncSourceType,
)
from mapkeeper.services.idempotency import (
    find_replayable_job,
    generation_request_hash,
    proposal_request_hash,
)

pytestmark = pytest.mark.asyncio

CHANGES: Final[JsonValue] = [
    {
        "field": "businessHours",
        "currentValue": {"open": "09:00", "close": "22:00"},
        "proposedValue": {"open": "09:00", "close": "20:00"},
    }
]


async def _store(session: AsyncSession) -> StoreProfile:
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


async def _proposal(session: AsyncSession, profile_id: UUID) -> StoreChangeProposal:
    proposal = StoreChangeProposal(
        store_profile_id=profile_id,
        recognized_text_masked="영업시간을 오후 8시까지로 바꿔줘",
        changes=CHANGES,
        status=ProposalStatus.APPROVED,
    )
    session.add(proposal)
    await session.flush()
    return proposal


@dataclass(frozen=True)
class Approval:
    """One recorded approval: who approved what, under which key."""

    profile_id: UUID
    proposal_id: UUID
    actor: UUID
    key: str
    request_hash: str


async def _job(session: AsyncSession, approval: Approval) -> SyncJob:
    job = SyncJob(
        store_profile_id=approval.profile_id,
        source_type=SyncSourceType.STORE_CHANGE_PROPOSAL,
        store_change_proposal_id=approval.proposal_id,
        content_generation_id=None,
        status=SyncJobStatus.PENDING,
        approved_at=datetime.now(UTC),
        approved_by=approval.actor,
        idempotency_key=approval.key,
        idempotency_request_hash=approval.request_hash,
    )
    session.add(job)
    await session.flush()
    return job


async def test_an_unused_key_reports_no_previous_job(db_session: AsyncSession) -> None:
    # Given: an actor approving for the first time.
    request_hash = proposal_request_hash(uuid4(), CHANGES)

    # When: the key is looked up.
    found = await find_replayable_job(db_session, uuid4(), "first-approval", request_hash)

    # Then: the caller knows it must create the job.
    assert found is None


async def test_the_same_request_under_the_same_key_replays_the_existing_job(
    db_session: AsyncSession,
) -> None:
    # Given: an approval that already produced a job.
    profile = await _store(db_session)
    proposal = await _proposal(db_session, profile.id)
    actor, key = uuid4(), "approve-once"
    request_hash = proposal_request_hash(proposal.id, CHANGES)
    created = await _job(db_session, Approval(profile.id, proposal.id, actor, key, request_hash))

    # When: the identical request arrives again.
    found = await find_replayable_job(db_session, actor, key, request_hash)

    # Then: the caller returns the first job instead of syncing the platforms twice.
    assert found is not None
    assert found.id == created.id


async def test_the_same_key_on_a_different_request_is_a_conflict(
    db_session: AsyncSession,
) -> None:
    # Given: a key already used to approve one proposal.
    profile = await _store(db_session)
    proposal = await _proposal(db_session, profile.id)
    actor, key = uuid4(), "approve-once"
    _ = await _job(
        db_session,
        Approval(profile.id, proposal.id, actor, key, proposal_request_hash(proposal.id, CHANGES)),
    )

    # When: the same key is reused for another proposal.
    other = await _proposal(db_session, profile.id)

    # Then: the second approval is refused rather than silently replayed.
    with pytest.raises(IdempotencyConflictError):
        _ = await find_replayable_job(
            db_session, actor, key, proposal_request_hash(other.id, CHANGES)
        )


async def test_approving_a_regenerated_generation_under_the_old_key_is_a_conflict(
    db_session: AsyncSession,
) -> None:
    # Given: a UC2 approval recorded at revision 1.
    profile = await _store(db_session)
    proposal = await _proposal(db_session, profile.id)
    actor, key = uuid4(), "approve-generation"
    generation_id = uuid4()
    _ = await _job(
        db_session,
        Approval(profile.id, proposal.id, actor, key, generation_request_hash(generation_id, 1)),
    )

    # When: the same key is reused after a regenerate bumped the revision.
    # Then: the newer results are not approved under the old key.
    with pytest.raises(IdempotencyConflictError):
        _ = await find_replayable_job(
            db_session, actor, key, generation_request_hash(generation_id, 2)
        )


async def test_the_same_key_from_a_different_actor_is_independent(
    db_session: AsyncSession,
) -> None:
    # Given: one actor who already used a key.
    profile = await _store(db_session)
    proposal = await _proposal(db_session, profile.id)
    key = "shared-key"
    request_hash = proposal_request_hash(proposal.id, CHANGES)
    _ = await _job(db_session, Approval(profile.id, proposal.id, uuid4(), key, request_hash))

    # When: a different actor uses the same key value.
    found = await find_replayable_job(db_session, uuid4(), key, request_hash)

    # Then: idempotency is scoped per approver, as the contract states.
    assert found is None


async def test_the_database_refuses_a_second_job_for_one_key(db_session: AsyncSession) -> None:
    # Given: an approval already recorded under a key.
    profile = await _store(db_session)
    proposal = await _proposal(db_session, profile.id)
    actor, key = uuid4(), "race-key"
    request_hash = proposal_request_hash(proposal.id, CHANGES)
    _ = await _job(db_session, Approval(profile.id, proposal.id, actor, key, request_hash))

    # When: two concurrent approvals both try to insert.
    # Then: the unique constraint decides, so no duplicate external write happens.
    with pytest.raises(IntegrityError, match="uq_sync_job_approved_by_idempotency_key"):
        _ = await _job(db_session, Approval(profile.id, proposal.id, actor, key, request_hash))


async def test_the_stored_hash_is_the_one_the_service_computes(
    db_session: AsyncSession,
) -> None:
    # Given: a job written with a computed request hash.
    profile = await _store(db_session)
    proposal = await _proposal(db_session, profile.id)
    request_hash = proposal_request_hash(proposal.id, CHANGES)
    job = await _job(
        db_session, Approval(profile.id, proposal.id, uuid4(), "hash-check", request_hash)
    )

    # When: it is read back from PostgreSQL.
    await db_session.refresh(job)

    # Then: char(64) stored it without padding or truncation.
    assert job.idempotency_request_hash == request_hash


async def test_the_lookup_can_run_without_locking(db_session: AsyncSession) -> None:
    # Given: an existing approval.
    profile = await _store(db_session)
    proposal = await _proposal(db_session, profile.id)
    actor, key = uuid4(), "no-lock"
    request_hash = proposal_request_hash(proposal.id, CHANGES)
    created = await _job(db_session, Approval(profile.id, proposal.id, actor, key, request_hash))

    # When: a read-only caller looks it up without taking a row lock.
    found = await find_replayable_job(db_session, actor, key, request_hash, lock=False)

    # Then: the same decision is reached.
    assert found is not None
    assert found.id == created.id
