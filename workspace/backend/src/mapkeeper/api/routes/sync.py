"""SyncJob status and retry endpoints.

Handlers are declared here so the OpenAPI contract is complete for the frontend.
Their bodies land in T225 and return 501 until then.
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path, status

from mapkeeper.api.responses import (
    RESOURCE_ERRORS,
    TRANSITION_ERRORS,
    carry_request_id,
    error_responses,
)
from mapkeeper.api.routes.pending import not_implemented
from mapkeeper.api.schemas.common import ApiEnvelope
from mapkeeper.api.schemas.sync import SyncJobRetryResponse, SyncJobStatusResponse

router = APIRouter(prefix="/sync-jobs", tags=["sync"], dependencies=[Depends(carry_request_id)])

StatusEnvelope = ApiEnvelope[SyncJobStatusResponse]
RetryEnvelope = ApiEnvelope[SyncJobRetryResponse]


@router.get(
    "/{syncJobId}",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*RESOURCE_ERRORS),
    summary="Read the aggregate job status and per-platform detail",
)
async def get_sync_job(
    sync_job_id: Annotated[UUID, Path(alias="syncJobId")],
) -> StatusEnvelope:
    """Report job progress. A failed platform still returns 200 with status SUCCESS."""
    return not_implemented(sync_job_id)


@router.post(
    "/{syncJobId}/retry",
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Retry only the retryable failed platforms",
)
async def retry_sync_job(
    sync_job_id: Annotated[UUID, Path(alias="syncJobId")],
) -> RetryEnvelope:
    """Retry retryable failures only. No retryable task is 409 NO_RETRYABLE_TASKS."""
    return not_implemented(sync_job_id)


__all__ = ["router"]
