"""UC2 SEO content generation endpoints.

Handlers are declared here so the OpenAPI contract is complete for the frontend.
Their bodies land in T232~T234 and return 501 until then.
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
from mapkeeper.api.schemas.seo import (
    ContentGenerationApprovalResponse,
    ContentGenerationResponse,
    CreateContentGenerationRequest,
    RegenerateContentGenerationRequest,
)

router = APIRouter(
    prefix="/seo/generations",
    tags=["seo"],
    dependencies=[Depends(carry_request_id)],
)

GenerationEnvelope = ApiEnvelope[ContentGenerationResponse]
ApprovalEnvelope = ApiEnvelope[ContentGenerationApprovalResponse]


@router.post(
    "",
    status_code=status.HTTP_201_CREATED,
    responses=error_responses(*COMMON_ERRORS),
    summary="Generate one result for each of the three platforms",
)
async def create_generation(body: CreateContentGenerationRequest) -> GenerationEnvelope:
    """Take one common input and produce exactly one Google, Naver and Kakao result."""
    return not_implemented(body)


@router.post(
    "/{generationId}/regenerate",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Replace all three results of a DRAFT generation",
)
async def regenerate_generation(
    generation_id: Annotated[UUID, Path(alias="generationId")],
    body: RegenerateContentGenerationRequest,
) -> GenerationEnvelope:
    """Atomically replace all platform results and increment revision. DRAFT only."""
    return not_implemented(generation_id, body)


@router.post(
    "/{generationId}/reject",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Reject a whole DRAFT generation",
)
async def reject_generation(
    generation_id: Annotated[UUID, Path(alias="generationId")],
) -> GenerationEnvelope:
    """Move the whole generation to REJECTED. The request has no body."""
    return not_implemented(generation_id)


@router.post(
    "/{generationId}/approve",
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Approve a whole DRAFT generation and start synchronization",
)
async def approve_generation(
    generation_id: Annotated[UUID, Path(alias="generationId")],
    idempotency_key: IdempotencyKeyHeader,
) -> ApprovalEnvelope:
    """Approve every platform result at once. The request body carries no per-draft ids."""
    return not_implemented(generation_id, idempotency_key)


__all__ = ["router"]
