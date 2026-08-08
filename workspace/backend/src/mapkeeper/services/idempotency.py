"""Approval idempotency: replay the same request, refuse a reused key.

The contract scopes idempotency to ``approvedBy + Idempotency-Key``. Whether two
calls are "the same request" is decided by a SHA-256 over the approval's own inputs:
the proposal id with its approved changes for UC1, and the generation id with the
revision being approved for UC2.

This module only decides. Creating the SyncJob is T220 and T221.
"""

import json
from hashlib import sha256
from typing import Final
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.core.errors import IdempotencyConflictError
from mapkeeper.core.json_types import JsonValue
from mapkeeper.core.logging import fingerprint, get_logger
from mapkeeper.models import SyncJob, SyncSourceType

logger = get_logger(__name__)

REQUEST_HASH_LENGTH: Final = 64
IDEMPOTENCY_CONFLICT_MESSAGE: Final = "같은 Idempotency-Key가 다른 승인 요청에 이미 사용되었습니다."


def _digest(payload: JsonValue) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return sha256(canonical.encode("utf-8")).hexdigest()


def proposal_request_hash(proposal_id: UUID, changes: JsonValue) -> str:
    """Hash a UC1 approval from the proposal id and the changes being approved."""
    return _digest(
        {
            "sourceType": SyncSourceType.STORE_CHANGE_PROPOSAL.value,
            "proposalId": str(proposal_id),
            "changes": changes,
        }
    )


def generation_request_hash(generation_id: UUID, revision: int) -> str:
    """Hash a UC2 approval from the generation id and the revision being approved.

    Regenerating bumps the revision, so approving the new results is a different
    request even under the same key.
    """
    return _digest(
        {
            "sourceType": SyncSourceType.CONTENT_GENERATION.value,
            "generationId": str(generation_id),
            "revision": revision,
        }
    )


async def find_replayable_job(
    session: AsyncSession,
    approved_by: UUID,
    idempotency_key: str,
    request_hash: str,
    *,
    lock: bool = True,
) -> SyncJob | None:
    """Return the job this key already created, or None when the key is unused.

    Raises:
        IdempotencyConflictError: the key belongs to a different approval request.
    """
    statement = select(SyncJob).where(
        SyncJob.approved_by == approved_by,
        SyncJob.idempotency_key == idempotency_key,
    )
    if lock:
        statement = statement.with_for_update()
    existing = (await session.execute(statement)).scalar_one_or_none()

    if existing is None:
        return None

    if existing.idempotency_request_hash != request_hash:
        logger.warning(
            "idempotency conflict for key %s on job %s",
            fingerprint(idempotency_key),
            existing.id,
        )
        raise IdempotencyConflictError(IDEMPOTENCY_CONFLICT_MESSAGE)

    logger.info(
        "idempotent replay for key %s returning job %s",
        fingerprint(idempotency_key),
        existing.id,
    )
    return existing
