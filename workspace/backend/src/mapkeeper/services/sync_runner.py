"""Run the platform tasks of one job and keep the job status in step.

A successful platform is never touched again, which is what makes a retry safe: only
tasks the runner is given are executed, and the caller decides which those are.
"""

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from mapkeeper.adapters.base import PlatformSyncError, SyncRequest
from mapkeeper.adapters.normalization import normalize_exception
from mapkeeper.adapters.registry import get_adapter
from mapkeeper.core.logging import get_logger, job_context
from mapkeeper.models import PlatformSyncTask, PlatformSyncTaskStatus, SyncJob
from mapkeeper.services.status_aggregation import aggregate_task_status

logger = get_logger(__name__)

RUNNABLE_STATUSES = frozenset({PlatformSyncTaskStatus.PENDING, PlatformSyncTaskStatus.RETRYING})


async def load_tasks(session: AsyncSession, sync_job_id: UUID) -> list[PlatformSyncTask]:
    """Return every platform task of one job, ordered so output is stable."""
    statement = (
        select(PlatformSyncTask)
        .where(PlatformSyncTask.sync_job_id == sync_job_id)
        .order_by(PlatformSyncTask.platform)
    )
    return list((await session.execute(statement)).scalars().all())


async def refresh_job_status(session: AsyncSession, sync_job_id: UUID) -> SyncJob | None:
    """Recompute the job status from its platform tasks and store it."""
    job = await session.get(SyncJob, sync_job_id)
    if job is None:
        return None
    tasks = await load_tasks(session, sync_job_id)
    if not tasks:
        return job
    job.status = aggregate_task_status(tasks)
    await session.flush()
    return job


async def _execute(task: PlatformSyncTask, store_profile_id: UUID) -> None:
    adapter = get_adapter(task.platform)
    request = SyncRequest(
        sync_job_id=task.sync_job_id,
        store_profile_id=store_profile_id,
        platform=task.platform,
    )
    await adapter.publish(request)


def _record_failure(task: PlatformSyncTask, exc: BaseException) -> None:
    error = (
        exc.error if isinstance(exc, PlatformSyncError) else normalize_exception(task.platform, exc)
    )
    task.status = PlatformSyncTaskStatus.FAILED
    task.error_code = error.code.value
    task.error_message = error.message
    task.retryable = error.retryable


async def run_task(session: AsyncSession, task: PlatformSyncTask, store_profile_id: UUID) -> None:
    """Run one platform task and record its outcome, never raising to the caller."""
    task.status = PlatformSyncTaskStatus.PROCESSING
    task.attempt_count += 1
    task.last_attempt_at = datetime.now(UTC)
    task.next_retry_at = None
    await session.flush()

    try:
        await _execute(task, store_profile_id)
    except Exception as exc:  # noqa: BLE001 - every failure becomes a normalized error
        _record_failure(task, exc)
        logger.warning(
            "platform task failed %s code=%s",
            job_context(task.sync_job_id, task.platform.value),
            task.error_code,
        )
    else:
        task.status = PlatformSyncTaskStatus.SUCCESS
        task.error_code = None
        task.error_message = None
        task.retryable = None
    await session.flush()


async def run_job(session: AsyncSession, sync_job_id: UUID) -> SyncJob | None:
    """Run every task of the job that is waiting, then update the job status."""
    job = await session.get(SyncJob, sync_job_id)
    if job is None:
        logger.warning("sync job %s disappeared before it could run", sync_job_id)
        return None

    for task in await load_tasks(session, sync_job_id):
        if task.status in RUNNABLE_STATUSES:
            await run_task(session, task, job.store_profile_id)

    return await refresh_job_status(session, sync_job_id)


async def run_job_in_background(
    session_factory: async_sessionmaker[AsyncSession],
    sync_job_id: UUID,
) -> None:
    """Run a job in its own transaction, for use after the approving request commits."""
    async with session_factory() as session, session.begin():
        _ = await run_job(session, sync_job_id)
