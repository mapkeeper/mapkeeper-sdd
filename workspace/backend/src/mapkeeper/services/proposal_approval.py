"""T220: approve a UC1 proposal and record the whole outcome in one transaction.

Order matters. The idempotency check runs before the DRAFT check so that replaying
an approval returns the original job instead of reporting the proposal is no longer
a draft, which is what the API Contract requires of a repeated key.

Nothing here calls an external platform. Adapters run only after the caller commits.
"""

from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.api.schemas.store_change import (
    BusinessHoursChange,
    ProposalChange,
    RepresentativeMenuNameChange,
    TemporaryClosureChange,
)
from mapkeeper.core.errors import InvalidStateError, ResourceNotFoundError
from mapkeeper.core.json_types import JsonValue
from mapkeeper.core.logging import fingerprint, get_logger
from mapkeeper.models import ProposalStatus, StoreChangeProposal, StoreProfile, SyncSourceType
from mapkeeper.services.approval import (
    ApprovalRequest,
    ApprovalResult,
    ApprovalSource,
    create_sync_job,
)
from mapkeeper.services.idempotency import find_replayable_job, proposal_request_hash
from mapkeeper.services.proposal import has_effective_change

logger = get_logger(__name__)

PROPOSAL_NOT_FOUND_MESSAGE: Final = "요청한 변경안을 찾을 수 없습니다."
PROPOSAL_NOT_DRAFT_MESSAGE: Final = "이미 처리된 변경안은 승인할 수 없습니다."
EMPTY_PROPOSAL_MESSAGE: Final = "변경할 내용이 없는 변경안은 승인할 수 없습니다."
UNCHANGED_PROPOSAL_MESSAGE: Final = "현재 매장 정보와 달라진 내용이 없어 승인할 수 없습니다."
PROFILE_NOT_FOUND_MESSAGE: Final = "변경안에 연결된 매장 정보를 찾을 수 없습니다."

_changes_adapter: TypeAdapter[tuple[ProposalChange, ...]] = TypeAdapter(tuple[ProposalChange, ...])


def parse_changes(stored: JsonValue) -> tuple[ProposalChange, ...]:
    """Re-validate the stored changes before anything is written from them.

    The column is JSONB, so the approved values are checked against the same schema
    that accepted them rather than trusted on the way out.
    """
    return _changes_adapter.validate_python(stored)


def apply_changes(profile: StoreProfile, changes: tuple[ProposalChange, ...]) -> None:
    """Move the store profile to the target state the user approved."""
    for change in changes:
        if isinstance(change, BusinessHoursChange):
            profile.business_hours = {
                "open": change.proposed_value.open,
                "close": change.proposed_value.close,
            }
        elif isinstance(change, TemporaryClosureChange):
            profile.temporary_closure_start_date = change.proposed_value.start_date
            profile.temporary_closure_end_date = change.proposed_value.end_date
        elif isinstance(change, RepresentativeMenuNameChange):
            profile.representative_menu_name = change.proposed_value
        else:
            # The discriminated union has exactly 4 members, so eliminating the
            # first 3 leaves ParkingInfoChange (an explicit isinstance here would
            # be flagged as always true).
            profile.parking_info = change.proposed_value


async def _load_locked_proposal(session: AsyncSession, proposal_id: UUID) -> StoreChangeProposal:
    statement = (
        select(StoreChangeProposal).where(StoreChangeProposal.id == proposal_id).with_for_update()
    )
    proposal = (await session.execute(statement)).scalar_one_or_none()
    if proposal is None:
        raise ResourceNotFoundError(PROPOSAL_NOT_FOUND_MESSAGE)
    return proposal


async def approve_proposal(
    session: AsyncSession,
    proposal_id: UUID,
    approved_by: UUID,
    idempotency_key: str,
) -> ApprovalResult:
    """Approve a DRAFT proposal, update the store and queue the platform sync.

    The proposal, the store profile, the SyncJob and its three platform tasks are
    all written into the caller's transaction, so a failure anywhere leaves none
    of them behind.

    Raises:
        ResourceNotFoundError: the proposal or its store profile does not exist.
        InvalidStateError: the proposal is not a DRAFT.
        IdempotencyConflictError: the key was used for a different approval.
    """
    proposal = await _load_locked_proposal(session, proposal_id)
    request_hash = proposal_request_hash(proposal.id, proposal.changes)

    replay = await find_replayable_job(session, approved_by, idempotency_key, request_hash)
    if replay is not None:
        return ApprovalResult(sync_job=replay, replayed=True)

    if proposal.status is not ProposalStatus.DRAFT:
        raise InvalidStateError(PROPOSAL_NOT_DRAFT_MESSAGE)

    changes = parse_changes(proposal.changes)
    if not changes:
        raise InvalidStateError(EMPTY_PROPOSAL_MESSAGE)
    if not has_effective_change(changes):
        raise InvalidStateError(UNCHANGED_PROPOSAL_MESSAGE)

    profile = await session.get(StoreProfile, proposal.store_profile_id, with_for_update=True)
    if profile is None:
        raise ResourceNotFoundError(PROFILE_NOT_FOUND_MESSAGE)

    apply_changes(profile, changes)
    proposal.status = ProposalStatus.APPROVED
    proposal.approved_at = datetime.now(UTC)
    await session.flush()

    result = await create_sync_job(
        session,
        ApprovalSource(
            store_profile_id=profile.id,
            source_type=SyncSourceType.STORE_CHANGE_PROPOSAL,
            store_change_proposal_id=proposal.id,
        ),
        ApprovalRequest(approved_by, idempotency_key, request_hash),
    )
    logger.info(
        "approved proposal %s key %s syncJobId=%s",
        proposal.id,
        fingerprint(idempotency_key),
        result.sync_job.id,
    )
    return result
