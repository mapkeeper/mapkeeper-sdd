"""T221: approve a whole UC2 generation in one transaction.

UC2 approves the generation, never individual drafts, so no draft ids are accepted
and every platform result is approved together. As in UC1 the idempotency check runs
before the DRAFT check so a repeated key replays instead of reporting a bad state.

Nothing here calls an external platform. Adapters run only after the caller commits.
"""

from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.errors import InvalidStateError, ResourceNotFoundError
from mapkeeper.core.logging import fingerprint, get_logger
from mapkeeper.models import (
    ContentGeneration,
    ContentGenerationStatus,
    LocalSEOContent,
    SyncSourceType,
)
from mapkeeper.services.approval import (
    SYNCED_PLATFORMS,
    ApprovalRequest,
    ApprovalResult,
    ApprovalSource,
    create_sync_job,
)
from mapkeeper.services.idempotency import find_replayable_job, generation_request_hash

logger = get_logger(__name__)

GENERATION_NOT_FOUND_MESSAGE: Final = "요청한 생성 결과를 찾을 수 없습니다."
GENERATION_NOT_DRAFT_MESSAGE: Final = "이미 처리된 생성 결과는 승인할 수 없습니다."
INCOMPLETE_RESULTS_MESSAGE: Final = "세 플랫폼 결과가 모두 준비되지 않아 승인할 수 없습니다."


async def _load_locked_generation(
    session: AsyncSession,
    generation_id: UUID,
) -> ContentGeneration:
    statement = (
        select(ContentGeneration).where(ContentGeneration.id == generation_id).with_for_update()
    )
    generation = (await session.execute(statement)).scalar_one_or_none()
    if generation is None:
        raise ResourceNotFoundError(GENERATION_NOT_FOUND_MESSAGE)
    return generation


async def _require_every_platform_result(session: AsyncSession, generation_id: UUID) -> None:
    statement = select(LocalSEOContent.platform).where(
        LocalSEOContent.content_generation_id == generation_id
    )
    stored = frozenset((await session.execute(statement)).scalars().all())
    if stored != frozenset(SYNCED_PLATFORMS):
        raise InvalidStateError(INCOMPLETE_RESULTS_MESSAGE)


async def approve_generation(
    session: AsyncSession,
    generation_id: UUID,
    approved_by: UUID,
    idempotency_key: str,
) -> ApprovalResult:
    """Approve every platform result at once and queue the platform sync.

    The generation, the SyncJob and its three platform tasks are all written into
    the caller's transaction, so a failure anywhere leaves none of them behind.

    Raises:
        ResourceNotFoundError: the generation does not exist.
        InvalidStateError: the generation is not a DRAFT, or a platform result is
            missing so the three approvals would not be equivalent.
        IdempotencyConflictError: the key was used for a different approval.
    """
    generation = await _load_locked_generation(session, generation_id)
    request_hash = generation_request_hash(generation.id, generation.revision)

    replay = await find_replayable_job(session, approved_by, idempotency_key, request_hash)
    if replay is not None:
        return ApprovalResult(sync_job=replay, replayed=True)

    if generation.status is not ContentGenerationStatus.DRAFT:
        raise InvalidStateError(GENERATION_NOT_DRAFT_MESSAGE)

    await _require_every_platform_result(session, generation.id)

    generation.status = ContentGenerationStatus.APPROVED
    generation.approved_at = datetime.now(UTC)
    await session.flush()

    result = await create_sync_job(
        session,
        ApprovalSource(
            store_profile_id=generation.store_profile_id,
            source_type=SyncSourceType.CONTENT_GENERATION,
            content_generation_id=generation.id,
        ),
        ApprovalRequest(approved_by, idempotency_key, request_hash),
    )
    logger.info(
        "approved generation %s revision %s key %s syncJobId=%s",
        generation.id,
        generation.revision,
        fingerprint(idempotency_key),
        result.sync_job.id,
    )
    return result
