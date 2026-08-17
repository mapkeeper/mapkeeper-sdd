"""T224 and T226 against live PostgreSQL: retry preserves success, restart recovers."""

from collections.abc import Sequence
from datetime import UTC, datetime, timedelta
from typing import Final
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.errors import NoRetryableTasksError, ResourceNotFoundError
from mapkeeper.models import (
    Platform,
    PlatformErrorCode,
    PlatformSyncTask,
    PlatformSyncTaskStatus,
    SyncJob,
    SyncJobStatus,
    SyncSourceType,
)
from mapkeeper.services.approval import ApprovalRequest, ApprovalSource, create_sync_job
from mapkeeper.services.recovery import fail_interrupted_tasks
from mapkeeper.services.retry import MAX_ATTEMPTS, backoff_delay, schedule_retry
from mapkeeper.services.sync_runner import load_tasks, run_job

from .factories import make_proposal, make_store_profile

pytestmark = pytest.mark.asyncio

FAILURE_MESSAGE: Final = "플랫폼 서버에 일시적인 문제가 있습니다."


async def _job_with_tasks(
    session: AsyncSession,
    statuses: Sequence[tuple[Platform, PlatformSyncTaskStatus]],
    *,
    retryable: bool | None = True,
    attempts: int = 1,
) -> SyncJob:
    profile = await make_store_profile(session)
    proposal = await make_proposal(session, profile.id)
    result = await create_sync_job(
        session,
        ApprovalSource(
            store_profile_id=profile.id,
            source_type=SyncSourceType.STORE_CHANGE_PROPOSAL,
            store_change_proposal_id=proposal.id,
        ),
        ApprovalRequest(uuid4(), f"key-{uuid4().hex}", "a" * 64),
    )
    job = result.sync_job

    for task in await load_tasks(session, job.id):
        wanted = dict(statuses).get(task.platform)
        if wanted is None:
            continue
        task.status = wanted
        task.attempt_count = attempts
        if wanted is PlatformSyncTaskStatus.FAILED:
            task.error_code = PlatformErrorCode.PLATFORM_SERVER_ERROR.value
            task.error_message = FAILURE_MESSAGE
            task.retryable = retryable
    await session.flush()
    return job


async def _tasks_by_platform(
    session: AsyncSession,
    sync_job_id: UUID,
) -> dict[Platform, PlatformSyncTask]:
    return {task.platform: task for task in await load_tasks(session, sync_job_id)}


async def test_retry_touches_only_the_failed_platform(db_session: AsyncSession) -> None:
    # Given: a job where Naver failed and the others succeeded.
    job = await _job_with_tasks(
        db_session,
        [
            (Platform.GOOGLE, PlatformSyncTaskStatus.SUCCESS),
            (Platform.NAVER, PlatformSyncTaskStatus.FAILED),
            (Platform.KAKAO, PlatformSyncTaskStatus.SUCCESS),
        ],
    )

    # When: the job is retried.
    platforms = await schedule_retry(db_session, job.id)

    # Then: only Naver runs again and the successful platforms are untouched.
    assert platforms == (Platform.NAVER,)
    tasks = await _tasks_by_platform(db_session, job.id)
    assert tasks[Platform.NAVER].status is PlatformSyncTaskStatus.RETRYING
    assert tasks[Platform.GOOGLE].status is PlatformSyncTaskStatus.SUCCESS
    assert tasks[Platform.KAKAO].status is PlatformSyncTaskStatus.SUCCESS


async def test_retry_schedules_a_backoff_before_the_next_attempt(
    db_session: AsyncSession,
) -> None:
    # Given: a platform that failed once.
    job = await _job_with_tasks(
        db_session,
        [(Platform.NAVER, PlatformSyncTaskStatus.FAILED)],
        attempts=1,
    )
    before = datetime.now(UTC)

    # When: it is queued for another attempt.
    _ = await schedule_retry(db_session, job.id)

    # Then: the next attempt waits rather than firing immediately.
    tasks = await _tasks_by_platform(db_session, job.id)
    next_retry_at = tasks[Platform.NAVER].next_retry_at
    assert next_retry_at is not None
    assert next_retry_at >= before + backoff_delay(1)


async def test_the_job_reports_retrying_while_a_platform_waits(
    db_session: AsyncSession,
) -> None:
    # Given: a partially failed job.
    job = await _job_with_tasks(
        db_session,
        [
            (Platform.GOOGLE, PlatformSyncTaskStatus.SUCCESS),
            (Platform.NAVER, PlatformSyncTaskStatus.FAILED),
            (Platform.KAKAO, PlatformSyncTaskStatus.SUCCESS),
        ],
    )

    # When: it is retried.
    _ = await schedule_retry(db_session, job.id)

    # Then: the status screen shows work is happening again.
    assert job.status is SyncJobStatus.RETRYING


async def test_a_non_retryable_failure_is_never_retried(db_session: AsyncSession) -> None:
    # Given: a permission failure, which would fail the same way again.
    job = await _job_with_tasks(
        db_session,
        [(Platform.NAVER, PlatformSyncTaskStatus.FAILED)],
        retryable=False,
    )

    # When / Then: the user is told there is nothing to retry.
    with pytest.raises(NoRetryableTasksError):
        _ = await schedule_retry(db_session, job.id)


async def test_a_fully_successful_job_has_nothing_to_retry(db_session: AsyncSession) -> None:
    # Given: a job where every platform succeeded.
    job = await _job_with_tasks(
        db_session,
        [
            (Platform.GOOGLE, PlatformSyncTaskStatus.SUCCESS),
            (Platform.NAVER, PlatformSyncTaskStatus.SUCCESS),
            (Platform.KAKAO, PlatformSyncTaskStatus.SUCCESS),
        ],
    )

    # When / Then: retrying would risk repeating work that already landed.
    with pytest.raises(NoRetryableTasksError):
        _ = await schedule_retry(db_session, job.id)


async def test_a_platform_stops_after_three_attempts(db_session: AsyncSession) -> None:
    # Given: a platform that already used all three attempts.
    job = await _job_with_tasks(
        db_session,
        [(Platform.NAVER, PlatformSyncTaskStatus.FAILED)],
        attempts=MAX_ATTEMPTS,
    )

    # When / Then: the contract's ceiling stops the loop.
    with pytest.raises(NoRetryableTasksError):
        _ = await schedule_retry(db_session, job.id)


async def test_retrying_an_unknown_job_is_reported_as_missing(
    db_session: AsyncSession,
) -> None:
    # Given: an id that belongs to no job.

    # When / Then: the caller sees 404 rather than a database error.
    with pytest.raises(ResourceNotFoundError):
        _ = await schedule_retry(db_session, uuid4())


async def test_running_a_retry_reruns_only_the_waiting_platform(
    db_session: AsyncSession,
) -> None:
    # Given: a retried job whose other platforms already succeeded.
    job = await _job_with_tasks(
        db_session,
        [
            (Platform.GOOGLE, PlatformSyncTaskStatus.SUCCESS),
            (Platform.NAVER, PlatformSyncTaskStatus.FAILED),
            (Platform.KAKAO, PlatformSyncTaskStatus.SUCCESS),
        ],
    )
    _ = await schedule_retry(db_session, job.id)
    tasks = await _tasks_by_platform(db_session, job.id)
    tasks[Platform.NAVER].next_retry_at = datetime.now(UTC) - timedelta(seconds=1)

    # When: the runner processes the job.
    _ = await run_job(db_session, job.id)

    # Then: the retried platform succeeds and the others were not attempted again.
    tasks = await _tasks_by_platform(db_session, job.id)
    assert tasks[Platform.NAVER].status is PlatformSyncTaskStatus.SUCCESS
    assert tasks[Platform.NAVER].attempt_count == 2
    assert tasks[Platform.GOOGLE].attempt_count == 1
    assert job.status is SyncJobStatus.SUCCESS


async def test_retry_does_not_run_before_its_scheduled_time(
    db_session: AsyncSession,
) -> None:
    # Given: a failed platform was scheduled with a future nextRetryAt.
    job = await _job_with_tasks(
        db_session,
        [(Platform.NAVER, PlatformSyncTaskStatus.FAILED)],
    )
    _ = await schedule_retry(db_session, job.id)

    # When: the runner is invoked before that time.
    _ = await run_job(db_session, job.id)

    # Then: no adapter attempt starts early and the task keeps waiting.
    tasks = await _tasks_by_platform(db_session, job.id)
    assert tasks[Platform.NAVER].status is PlatformSyncTaskStatus.RETRYING
    assert tasks[Platform.NAVER].attempt_count == 1


async def test_a_successful_run_clears_the_previous_error(db_session: AsyncSession) -> None:
    # Given: a platform that failed and is being retried.
    job = await _job_with_tasks(db_session, [(Platform.NAVER, PlatformSyncTaskStatus.FAILED)])
    _ = await schedule_retry(db_session, job.id)
    tasks = await _tasks_by_platform(db_session, job.id)
    tasks[Platform.NAVER].next_retry_at = datetime.now(UTC) - timedelta(seconds=1)

    # When: the retry succeeds.
    _ = await run_job(db_session, job.id)

    # Then: the status screen no longer shows a stale failure.
    tasks = await _tasks_by_platform(db_session, job.id)
    assert tasks[Platform.NAVER].error_code is None
    assert tasks[Platform.NAVER].error_message is None
    assert tasks[Platform.NAVER].retryable is None


async def test_a_restart_fails_work_it_interrupted(db_session: AsyncSession) -> None:
    # Given: tasks left mid-flight when the process stopped.
    job = await _job_with_tasks(
        db_session,
        [
            (Platform.GOOGLE, PlatformSyncTaskStatus.PROCESSING),
            (Platform.NAVER, PlatformSyncTaskStatus.RETRYING),
            (Platform.KAKAO, PlatformSyncTaskStatus.SUCCESS),
        ],
    )

    # When: the service starts again.
    recovered = await fail_interrupted_tasks(db_session)

    # Then: nothing is left waiting for a runner that no longer exists.
    assert recovered == 2
    tasks = await _tasks_by_platform(db_session, job.id)
    assert tasks[Platform.GOOGLE].status is PlatformSyncTaskStatus.FAILED
    assert tasks[Platform.NAVER].status is PlatformSyncTaskStatus.FAILED
    assert tasks[Platform.KAKAO].status is PlatformSyncTaskStatus.SUCCESS


async def test_recovered_work_can_be_retried_by_the_user(db_session: AsyncSession) -> None:
    # Given: a task a restart abandoned.
    job = await _job_with_tasks(db_session, [(Platform.NAVER, PlatformSyncTaskStatus.PROCESSING)])
    _ = await fail_interrupted_tasks(db_session)

    # When: the user asks to retry.
    platforms = await schedule_retry(db_session, job.id)

    # Then: an interrupted platform is offered as retryable rather than stuck.
    assert Platform.NAVER in platforms


async def test_recovery_updates_the_job_status(db_session: AsyncSession) -> None:
    # Given: an interrupted job whose other platform succeeded.
    job = await _job_with_tasks(
        db_session,
        [
            (Platform.GOOGLE, PlatformSyncTaskStatus.SUCCESS),
            (Platform.NAVER, PlatformSyncTaskStatus.PROCESSING),
            (Platform.KAKAO, PlatformSyncTaskStatus.SUCCESS),
        ],
    )

    # When: the service recovers on start.
    _ = await fail_interrupted_tasks(db_session)

    # Then: the job stops claiming it is still processing.
    assert job.status is SyncJobStatus.PARTIAL_SUCCESS


async def test_recovery_does_nothing_when_no_work_was_interrupted(
    db_session: AsyncSession,
) -> None:
    # Given: a database whose tasks all reached a terminal state.
    _ = await _job_with_tasks(
        db_session,
        [
            (Platform.GOOGLE, PlatformSyncTaskStatus.SUCCESS),
            (Platform.NAVER, PlatformSyncTaskStatus.SUCCESS),
            (Platform.KAKAO, PlatformSyncTaskStatus.SUCCESS),
        ],
    )
    stranded = await db_session.scalar(
        select(PlatformSyncTask.id).where(
            PlatformSyncTask.status.in_(
                [PlatformSyncTaskStatus.PROCESSING, PlatformSyncTaskStatus.RETRYING]
            )
        )
    )
    assert stranded is None

    # When / Then: a clean start reports nothing to recover.
    assert await fail_interrupted_tasks(db_session) == 0
