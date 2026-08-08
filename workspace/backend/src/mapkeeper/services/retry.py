"""T224: retry only the platforms that failed and could still succeed.

A platform that already succeeded is never re-run, so a retry can never undo or
duplicate work that landed. Timeout, rate limiting and platform server errors are
retried up to three attempts in total, with an exponential wait between them.
"""

from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.errors import NoRetryableTasksError, ResourceNotFoundError
from mapkeeper.core.logging import get_logger, job_context
from mapkeeper.models import (
    Platform,
    PlatformSyncTask,
    PlatformSyncTaskStatus,
    SyncJob,
    SyncJobStatus,
)

logger = get_logger(__name__)

MAX_ATTEMPTS: Final = 3
BACKOFF_BASE_SECONDS: Final = 2
JOB_NOT_FOUND_MESSAGE: Final = "요청한 동기화 작업을 찾을 수 없습니다."
NO_RETRYABLE_TASKS_MESSAGE: Final = "다시 시도할 수 있는 플랫폼이 없습니다."


def backoff_delay(attempt_count: int) -> timedelta:
    """Return how long to wait before the attempt that follows the given one."""
    return timedelta(seconds=float(BACKOFF_BASE_SECONDS) ** attempt_count)


def is_retryable(task: PlatformSyncTask) -> bool:
    """Return whether this platform may be attempted again.

    A successful platform is excluded, an error the platform would repeat is
    excluded, and so is a task that already used its three attempts.
    """
    return (
        task.status is PlatformSyncTaskStatus.FAILED
        and task.retryable is True
        and task.attempt_count < MAX_ATTEMPTS
    )


async def _load_locked_job(session: AsyncSession, sync_job_id: UUID) -> SyncJob:
    statement = select(SyncJob).where(SyncJob.id == sync_job_id).with_for_update()
    job = (await session.execute(statement)).scalar_one_or_none()
    if job is None:
        raise ResourceNotFoundError(JOB_NOT_FOUND_MESSAGE)
    return job


async def schedule_retry(session: AsyncSession, sync_job_id: UUID) -> tuple[Platform, ...]:
    """Move every retryable failed platform to RETRYING inside one row lock.

    Returns:
        The platforms that will be attempted again, in a stable order.

    Raises:
        ResourceNotFoundError: the job does not exist.
        NoRetryableTasksError: nothing failed in a way that another attempt could fix.
    """
    job = await _load_locked_job(session, sync_job_id)

    statement = (
        select(PlatformSyncTask)
        .where(PlatformSyncTask.sync_job_id == sync_job_id)
        .order_by(PlatformSyncTask.platform)
        .with_for_update()
    )
    tasks = list((await session.execute(statement)).scalars().all())
    retryable = [task for task in tasks if is_retryable(task)]
    if not retryable:
        raise NoRetryableTasksError(NO_RETRYABLE_TASKS_MESSAGE)

    now = datetime.now(UTC)
    for task in retryable:
        task.status = PlatformSyncTaskStatus.RETRYING
        task.next_retry_at = now + backoff_delay(task.attempt_count)

    job.status = SyncJobStatus.RETRYING
    await session.flush()

    platforms = tuple(task.platform for task in retryable)
    logger.info(
        "retrying %s for %s",
        [platform.value for platform in platforms],
        job_context(sync_job_id),
    )
    return platforms
