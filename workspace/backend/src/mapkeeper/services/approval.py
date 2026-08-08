"""Pieces shared by the UC1 and UC2 approval transactions.

Both use cases end the same way: one SyncJob in PENDING with exactly one
PlatformSyncTask per platform, written inside the caller's transaction. No external
platform adapter runs here; that only happens after the caller commits.
"""

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.models import (
    Platform,
    PlatformSyncTask,
    PlatformSyncTaskStatus,
    SyncJob,
    SyncJobStatus,
    SyncSourceType,
)
from mapkeeper.services.idempotency import find_replayable_job

SYNCED_PLATFORMS: Final[tuple[Platform, ...]] = (Platform.GOOGLE, Platform.NAVER, Platform.KAKAO)


@dataclass(frozen=True)
class ApprovalResult:
    """The job an approval produced, and whether it already existed."""

    sync_job: SyncJob
    replayed: bool


@dataclass(frozen=True)
class ApprovalSource:
    """Which store, and which approved record, a job is being created for."""

    store_profile_id: UUID
    source_type: SyncSourceType
    store_change_proposal_id: UUID | None = None
    content_generation_id: UUID | None = None


@dataclass(frozen=True)
class ApprovalRequest:
    """Everything an approval needs that does not come from the approved source."""

    approved_by: UUID
    idempotency_key: str
    request_hash: str


def build_platform_tasks(sync_job_id: UUID) -> list[PlatformSyncTask]:
    """Return one PENDING task per platform, which is what the contract promises."""
    return [
        PlatformSyncTask(
            sync_job_id=sync_job_id,
            platform=platform,
            status=PlatformSyncTaskStatus.PENDING,
            attempt_count=0,
        )
        for platform in SYNCED_PLATFORMS
    ]


async def create_sync_job(
    session: AsyncSession,
    source: ApprovalSource,
    request: ApprovalRequest,
) -> ApprovalResult:
    """Write one PENDING job and its three platform tasks.

    A concurrent approval that reached the unique key first is detected here: the
    savepoint is released, the existing job is re-read, and the caller either
    replays it or sees the conflict.
    """
    job = SyncJob(
        store_profile_id=source.store_profile_id,
        source_type=source.source_type,
        store_change_proposal_id=source.store_change_proposal_id,
        content_generation_id=source.content_generation_id,
        status=SyncJobStatus.PENDING,
        approved_at=datetime.now(UTC),
        approved_by=request.approved_by,
        idempotency_key=request.idempotency_key,
        idempotency_request_hash=request.request_hash,
    )
    try:
        async with session.begin_nested():
            session.add(job)
            await session.flush()
            session.add_all(build_platform_tasks(job.id))
            await session.flush()
    except IntegrityError:
        existing = await find_replayable_job(
            session,
            request.approved_by,
            request.idempotency_key,
            request.request_hash,
        )
        if existing is None:
            raise
        return ApprovalResult(sync_job=existing, replayed=True)

    return ApprovalResult(sync_job=job, replayed=False)
