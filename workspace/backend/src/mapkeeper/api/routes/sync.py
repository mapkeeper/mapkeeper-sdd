"""T225: SyncJob status and retry endpoints."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, Path, status
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.api.responses import (
    RESOURCE_ERRORS,
    TRANSITION_ERRORS,
    carry_request_id,
    error_responses,
)
from mapkeeper.api.schemas.common import ApiEnvelope
from mapkeeper.api.schemas.sync import (
    PlatformTaskError,
    PlatformTaskStatus,
    SyncJobRetryResponse,
    SyncJobStatusResponse,
)
from mapkeeper.core.errors import ResourceNotFoundError
from mapkeeper.db.session import get_session, get_session_factory
from mapkeeper.models import ApiResponseStatus, PlatformErrorCode, PlatformSyncTask, SyncJob
from mapkeeper.services.retry import JOB_NOT_FOUND_MESSAGE, schedule_retry
from mapkeeper.services.sync_runner import load_tasks, run_job_in_background

router = APIRouter(prefix="/sync-jobs", tags=["sync"], dependencies=[Depends(carry_request_id)])

StatusEnvelope = ApiEnvelope[SyncJobStatusResponse]
RetryEnvelope = ApiEnvelope[SyncJobRetryResponse]

SessionDep = Annotated[AsyncSession, Depends(get_session)]


def status_url(sync_job_id: UUID) -> str:
    """Return where a client polls this job."""
    return f"/api/v1/sync-jobs/{sync_job_id}"


def describe_task(task: PlatformSyncTask) -> PlatformTaskStatus:
    """Render one platform task for the status screen."""
    error = None
    if task.error_code is not None:
        error = PlatformTaskError(
            code=PlatformErrorCode(task.error_code),
            message=task.error_message or "",
            retryable=bool(task.retryable),
            platform=task.platform,
        )
    return PlatformTaskStatus(
        platform=task.platform,
        status=task.status,
        attempt_count=task.attempt_count,
        error=error,
    )


@router.get(
    "/{syncJobId}",
    status_code=status.HTTP_200_OK,
    responses=error_responses(*RESOURCE_ERRORS),
    summary="Read the aggregate job status and per-platform detail",
)
async def get_sync_job(
    sync_job_id: Annotated[UUID, Path(alias="syncJobId")],
    session: SessionDep,
) -> StatusEnvelope:
    """Report job progress. A failed platform still returns 200 with status SUCCESS."""
    job = await session.get(SyncJob, sync_job_id)
    if job is None:
        raise ResourceNotFoundError(JOB_NOT_FOUND_MESSAGE)
    tasks = await load_tasks(session, sync_job_id)
    return StatusEnvelope(
        success=True,
        status=ApiResponseStatus.SUCCESS,
        data=SyncJobStatusResponse(
            sync_job_id=job.id,
            status=job.status,
            platform_tasks=tuple(describe_task(task) for task in tasks),
        ),
        error=None,
        timestamp=datetime.now(UTC),
    )


@router.post(
    "/{syncJobId}/retry",
    status_code=status.HTTP_202_ACCEPTED,
    responses=error_responses(*TRANSITION_ERRORS),
    summary="Retry only the retryable failed platforms",
)
async def retry_sync_job(
    sync_job_id: Annotated[UUID, Path(alias="syncJobId")],
    session: SessionDep,
    background_tasks: BackgroundTasks,
) -> RetryEnvelope:
    """Retry retryable failures only. No retryable task is 409 NO_RETRYABLE_TASKS."""
    platforms = await schedule_retry(session, sync_job_id)
    await session.commit()

    # Only after the commit, so a failed run can never precede the state it acts on.
    background_tasks.add_task(run_job_in_background, get_session_factory(), sync_job_id)

    job = await session.get(SyncJob, sync_job_id)
    if job is None:  # pragma: no cover - the row was locked moments ago
        raise ResourceNotFoundError(JOB_NOT_FOUND_MESSAGE)
    return RetryEnvelope(
        success=True,
        status=ApiResponseStatus.PROCESSING,
        data=SyncJobRetryResponse(
            sync_job_id=job.id,
            status=job.status,
            retrying_platforms=platforms,
            status_url=status_url(job.id),
        ),
        error=None,
        timestamp=datetime.now(UTC),
    )


__all__ = ["router"]
