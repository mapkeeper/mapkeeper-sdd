"""How the runner records a platform failure, and what it does when data is missing."""

from typing import Final
from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.adapters.base import (
    PlatformAdapter,
    PlatformError,
    PlatformSyncError,
    SyncRequest,
)
from mapkeeper.adapters.registry import AcceptingAdapter
from mapkeeper.models import (
    Platform,
    PlatformErrorCode,
    PlatformSyncTaskStatus,
    SyncJobStatus,
    SyncSourceType,
)
from mapkeeper.services.approval import ApprovalRequest, ApprovalSource, create_sync_job
from mapkeeper.services.sync_runner import load_tasks, refresh_job_status, run_job

from .factories import make_proposal, make_store_profile

pytestmark = pytest.mark.asyncio

REFUSED: Final = PlatformError(
    code=PlatformErrorCode.PERMISSION_DENIED,
    platform=Platform.NAVER,
)


class RefusingAdapter:
    """Adapter that reports a platform refusing the update."""

    platform: Platform = Platform.NAVER

    async def publish(self, request: SyncRequest) -> None:
        """Refuse every request with a non-retryable error."""
        _ = request
        raise PlatformSyncError(REFUSED)


class BrokenAdapter:
    """Adapter whose client fails in a way nobody normalized."""

    platform: Platform = Platform.KAKAO

    async def publish(self, request: SyncRequest) -> None:
        """Fail with a raw transport error."""
        _ = request
        message = "connection reset by peer"
        raise OSError(message)


async def _pending_job(session: AsyncSession) -> UUID:
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
    return result.sync_job.id


async def test_a_job_whose_platforms_all_accept_reports_success(
    db_session: AsyncSession,
) -> None:
    # Given: a freshly approved job.
    job_id = await _pending_job(db_session)

    # When: the runner processes it.
    job = await run_job(db_session, job_id)

    # Then: every platform reports one successful attempt.
    assert job is not None
    assert job.status is SyncJobStatus.SUCCESS
    tasks = await load_tasks(db_session, job_id)
    assert all(task.status is PlatformSyncTaskStatus.SUCCESS for task in tasks)
    assert all(task.attempt_count == 1 for task in tasks)
    assert all(task.last_attempt_at is not None for task in tasks)


async def test_a_refused_platform_is_recorded_without_leaking_detail(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: a platform that refuses the update.
    job_id = await _pending_job(db_session)

    def refuse_naver(platform: Platform) -> PlatformAdapter:
        return RefusingAdapter() if platform is Platform.NAVER else AcceptingAdapter(platform)

    monkeypatch.setattr("mapkeeper.services.sync_runner.get_adapter", refuse_naver)

    # When: the runner processes the job.
    job = await run_job(db_session, job_id)

    # Then: the failure is stored as a contract code with a safe message.
    assert job is not None
    assert job.status is SyncJobStatus.PARTIAL_SUCCESS
    naver = next(
        task for task in await load_tasks(db_session, job_id) if task.platform is Platform.NAVER
    )
    assert naver.status is PlatformSyncTaskStatus.FAILED
    assert naver.error_code == PlatformErrorCode.PERMISSION_DENIED.value
    assert naver.retryable is False
    assert naver.error_message is not None
    assert "reset" not in naver.error_message


async def test_an_unnormalized_client_failure_is_still_recorded(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # Given: a client that raises a raw transport error.
    job_id = await _pending_job(db_session)

    def break_kakao(platform: Platform) -> PlatformAdapter:
        return BrokenAdapter() if platform is Platform.KAKAO else AcceptingAdapter(platform)

    monkeypatch.setattr("mapkeeper.services.sync_runner.get_adapter", break_kakao)

    # When: the runner processes the job.
    _ = await run_job(db_session, job_id)

    # Then: it becomes a retryable platform server error, not an unhandled crash.
    kakao = next(
        task for task in await load_tasks(db_session, job_id) if task.platform is Platform.KAKAO
    )
    assert kakao.error_code == PlatformErrorCode.PLATFORM_SERVER_ERROR.value
    assert kakao.retryable is True
    assert kakao.error_message is not None
    assert "peer" not in kakao.error_message


async def test_running_a_job_that_disappeared_does_nothing(db_session: AsyncSession) -> None:
    # Given: an id that belongs to no job.

    # When / Then: the background runner reports nothing instead of raising.
    assert await run_job(db_session, uuid4()) is None
    assert await refresh_job_status(db_session, uuid4()) is None
