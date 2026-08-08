"""UC1 store change proposal endpoints.

Handlers are declared here so the OpenAPI contract is complete for the frontend.
Their bodies land in T227~T229 and return 501 until then.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, status

from mapkeeper.api.responses import (
    COMMON_ERRORS,
    TRANSITION_ERRORS,
    IdempotencyKeyHeader,
    carry_request_id,
    error_responses,
)
from mapkeeper.api.routes.pending import not_implemented
from mapkeeper.api.schemas.common import ApiEnvelope
from mapkeeper.api.schemas.store_change import (
    CreateStoreChangeProposalRequest,
    PatchStoreChangeProposalRequest,
    StoreChangeProposalApprovalResponse,
    StoreChangeProposalResponse,
)

router = APIRouter(
    prefix="/store-change-proposals",
    tags=["store-change"],
    dependencies=[Depends(carry_request_id)],
)

ProposalEnvelope = ApiEnvelope[StoreChangeProposalResponse]
ApprovalEnvelope = ApiEnvelope[StoreChangeProposalApprovalResponse]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(*COMMON_ERRORS),
    summary="Create a store change proposal",
)
async def create_proposal(body: CreateStoreChangeProposalRequest) -> ProposalEnvelope:
    """Turn recognized speech into a masked, structured DRAFT proposal."""
    return not_implemented(body)


@router.patch(
    "/{proposalId}",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Replace the changes of a DRAFT proposal",
)
async def patch_proposal(
    proposal_id: Annotated[UUID, Path(alias="proposalId")],
    body: PatchStoreChangeProposalRequest,
) -> ProposalEnvelope:
    """Replace the full change list. A stale currentValue is 409 STALE_PROPOSAL."""
    return not_implemented(proposal_id, body)


@router.post(
    "/{proposalId}/reject",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Reject a DRAFT proposal",
)
async def reject_proposal(
    proposal_id: Annotated[UUID, Path(alias="proposalId")],
) -> ProposalEnvelope:
    """Move a DRAFT proposal to REJECTED. The request has no body."""
    return not_implemented(proposal_id)


@router.post(
    "/{proposalId}/approve",
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Approve a DRAFT proposal and start synchronization",
)
async def approve_proposal(
    proposal_id: Annotated[UUID, Path(alias="proposalId")],
    idempotency_key: IdempotencyKeyHeader,
) -> ApprovalEnvelope:
    """Approve the proposal and create one SyncJob with three platform tasks atomically."""
    return not_implemented(proposal_id, idempotency_key)


__all__ = ["router"]
