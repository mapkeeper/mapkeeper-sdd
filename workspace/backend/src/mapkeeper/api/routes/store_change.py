"""UC1 store change proposal endpoints."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.api.responses import (
    COMMON_ERRORS,
    TRANSITION_ERRORS,
    IdempotencyKeyHeader,
    carry_request_id,
    error_responses,
)
from mapkeeper.api.schemas.common import ApiEnvelope
from mapkeeper.api.schemas.store_change import (
    CreateStoreChangeProposalRequest,
    PatchStoreChangeProposalRequest,
    StoreChangeProposalApprovalResponse,
    StoreChangeProposalResponse,
)
from mapkeeper.core.config import get_settings
from mapkeeper.db.session import get_session, get_session_factory
from mapkeeper.models import ApiResponseStatus, ProposalStatus
from mapkeeper.services.proposal import (
    create_proposal as create_proposal_service,
)
from mapkeeper.services.proposal import (
    patch_proposal as patch_proposal_service,
)
from mapkeeper.services.proposal import (
    reject_proposal as reject_proposal_service,
)
from mapkeeper.services.proposal_approval import approve_proposal as approve_proposal_service
from mapkeeper.services.sync_runner import run_job_in_background

router = APIRouter(
    prefix="/store-change-proposals",
    tags=["store-change"],
    dependencies=[Depends(carry_request_id)],
)

ProposalEnvelope = ApiEnvelope[StoreChangeProposalResponse]
ApprovalEnvelope = ApiEnvelope[StoreChangeProposalApprovalResponse]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _success(data: StoreChangeProposalResponse) -> ProposalEnvelope:
    """Wrap a proposal in the common success envelope."""
    return ProposalEnvelope(
        success=True,
        status=ApiResponseStatus.SUCCESS,
        data=data,
        error=None,
        timestamp=datetime.now(UTC),
    )


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(*COMMON_ERRORS),
    summary="Create a store change proposal",
)
async def create_proposal(
    body: CreateStoreChangeProposalRequest,
    session: SessionDep,
) -> ProposalEnvelope:
    """Turn recognized speech into a masked, structured DRAFT proposal."""
    data = await create_proposal_service(session, body)
    await session.commit()
    return _success(data)


@router.patch(
    "/{proposalId}",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Replace the changes of a DRAFT proposal",
)
async def patch_proposal(
    proposal_id: Annotated[UUID, Path(alias="proposalId")],
    body: PatchStoreChangeProposalRequest,
    session: SessionDep,
) -> ProposalEnvelope:
    """Replace the full change list after stale currentValue checking."""
    data = await patch_proposal_service(session, proposal_id, body)
    await session.commit()
    return _success(data)


@router.post(
    "/{proposalId}/reject",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Reject a DRAFT proposal",
)
async def reject_proposal(
    proposal_id: Annotated[UUID, Path(alias="proposalId")],
    session: SessionDep,
) -> ProposalEnvelope:
    """Move a DRAFT proposal to REJECTED. The request has no body."""
    data = await reject_proposal_service(session, proposal_id)
    await session.commit()
    return _success(data)


@router.post(
    "/{proposalId}/approve",
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Approve a DRAFT proposal and start synchronization",
)
async def approve_proposal(
    proposal_id: Annotated[UUID, Path(alias="proposalId")],
    idempotency_key: IdempotencyKeyHeader,
    session: SessionDep,
    background_tasks: BackgroundTasks,
) -> ApprovalEnvelope:
    """Commit approval and queue synchronization only after the commit succeeds."""
    result = await approve_proposal_service(
        session,
        proposal_id,
        get_settings().mvp_actor_id,
        idempotency_key,
    )
    await session.commit()
    if not result.replayed:
        background_tasks.add_task(run_job_in_background, get_session_factory(), result.sync_job.id)
    return ApprovalEnvelope(
        success=True,
        status=ApiResponseStatus.PROCESSING,
        data=StoreChangeProposalApprovalResponse(
            proposal_id=proposal_id,
            proposal_status=ProposalStatus.APPROVED,
            sync_job_id=result.sync_job.id,
            status=result.sync_job.status,
            status_url=f"/api/v1/sync-jobs/{result.sync_job.id}",
        ),
        error=None,
        timestamp=datetime.now(UTC),
    )


__all__ = ["router"]
