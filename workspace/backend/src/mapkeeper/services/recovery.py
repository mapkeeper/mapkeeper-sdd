"""T226: close out work that a restart interrupted.

Platform tasks run in FastAPI BackgroundTasks, which do not survive a process
restart. Anything left PROCESSING or RETRYING has no runner behind it any more, so
it is marked FAILED and made retryable: the user can decide, instead of watching a
status that will never move.
"""

from typing import Final

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from mapkeeper.core.logging import get_logger
from mapkeeper.models import PlatformErrorCode, PlatformSyncTask, PlatformSyncTaskStatus
from mapkeeper.services.sync_runner import refresh_job_status

logger = get_logger(__name__)

INTERRUPTED_STATUSES: Final = (
    PlatformSyncTaskStatus.PROCESSING,
    PlatformSyncTaskStatus.RETRYING,
)
INTERRUPTED_MESSAGE: Final = "서버가 다시 시작되어 처리가 중단되었습니다."


async def fail_interrupted_tasks(session: AsyncSession) -> int:
    """Mark every task a restart abandoned as FAILED and refresh its job status.

    Returns:
        How many tasks were closed out.
    """
    statement = select(PlatformSyncTask).where(PlatformSyncTask.status.in_(INTERRUPTED_STATUSES))
    stranded = list((await session.execute(statement)).scalars().all())
    if not stranded:
        return 0

    for task in stranded:
        task.status = PlatformSyncTaskStatus.FAILED
        task.error_code = PlatformErrorCode.PLATFORM_SERVER_ERROR.value
        task.error_message = INTERRUPTED_MESSAGE
        task.retryable = True
        task.next_retry_at = None
    await session.flush()

    for sync_job_id in {task.sync_job_id for task in stranded}:
        _ = await refresh_job_status(session, sync_job_id)

    logger.warning("recovered %s platform tasks interrupted by a restart", len(stranded))
    return len(stranded)


async def recover_interrupted_work(session_factory: async_sessionmaker[AsyncSession]) -> int:
    """Run the restart recovery in its own committed transaction."""
    async with session_factory() as session, session.begin():
        return await fail_interrupted_tasks(session)
