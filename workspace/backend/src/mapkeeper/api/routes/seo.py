"""UC2 SEO content generation endpoints."""

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
from mapkeeper.api.schemas.seo import (
    ContentGenerationApprovalResponse,
    ContentGenerationResponse,
    CreateContentGenerationRequest,
    RegenerateContentGenerationRequest,
)
from mapkeeper.core.config import get_settings
from mapkeeper.db.session import get_session, get_session_factory
from mapkeeper.models import ApiResponseStatus, ContentGenerationStatus, Platform
from mapkeeper.services.generation_approval import approve_generation as approve_generation_service
from mapkeeper.services.seo_generation import create_generation as create_generation_service
from mapkeeper.services.seo_generation import regenerate_generation as regenerate_generation_service
from mapkeeper.services.seo_generation import reject_generation as reject_generation_service
from mapkeeper.services.sync_runner import run_job_in_background

router = APIRouter(
    prefix="/seo/generations",
    tags=["seo"],
    dependencies=[Depends(carry_request_id)],
)

GenerationEnvelope = ApiEnvelope[ContentGenerationResponse]
ApprovalEnvelope = ApiEnvelope[ContentGenerationApprovalResponse]
SessionDep = Annotated[AsyncSession, Depends(get_session)]


def _success(data: ContentGenerationResponse) -> GenerationEnvelope:
    """Wrap a generation in the common success envelope."""
    return GenerationEnvelope(
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
    summary="Generate one result for each of the three platforms",
)
async def create_generation(
    body: CreateContentGenerationRequest,
    session: SessionDep,
) -> GenerationEnvelope:
    """Take one common input and produce exactly one result per platform."""
    data = await create_generation_service(session, body, body.store_profile_id)
    await session.commit()
    return _success(data)


@router.post(
    "/{generationId}/regenerate",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Replace all three results of a DRAFT generation",
)
async def regenerate_generation(
    generation_id: Annotated[UUID, Path(alias="generationId")],
    body: RegenerateContentGenerationRequest,
    session: SessionDep,
) -> GenerationEnvelope:
    """Replace all platform results and increment revision on a DRAFT."""
    data = await regenerate_generation_service(session, generation_id, body)
    await session.commit()
    return _success(data)


@router.post(
    "/{generationId}/reject",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Reject a whole DRAFT generation",
)
async def reject_generation(
    generation_id: Annotated[UUID, Path(alias="generationId")],
    session: SessionDep,
) -> GenerationEnvelope:
    """Move the whole generation to REJECTED. The request has no body."""
    data = await reject_generation_service(session, generation_id)
    await session.commit()
    return _success(data)


@router.post(
    "/{generationId}/approve",
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Approve a whole DRAFT generation and start synchronization",
)
async def approve_generation(
    generation_id: Annotated[UUID, Path(alias="generationId")],
    idempotency_key: IdempotencyKeyHeader,
    session: SessionDep,
    background_tasks: BackgroundTasks,
) -> ApprovalEnvelope:
    """Commit whole-generation approval before queuing synchronization."""
    result = await approve_generation_service(
        session,
        generation_id,
        get_settings().mvp_actor_id,
        idempotency_key,
    )
    await session.commit()
    if not result.replayed:
        background_tasks.add_task(run_job_in_background, get_session_factory(), result.sync_job.id)
    return ApprovalEnvelope(
        success=True,
        status=ApiResponseStatus.PROCESSING,
        data=ContentGenerationApprovalResponse(
            generation_id=generation_id,
            generation_status=ContentGenerationStatus.APPROVED,
            approved_platforms=(Platform.GOOGLE, Platform.NAVER, Platform.KAKAO),
            sync_job_id=result.sync_job.id,
            status=result.sync_job.status,
            status_url=f"/api/v1/sync-jobs/{result.sync_job.id}",
        ),
        error=None,
        timestamp=datetime.now(UTC),
    )


__all__ = ["router"]
