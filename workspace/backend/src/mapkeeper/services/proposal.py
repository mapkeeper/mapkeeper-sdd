"""UC1 proposal creation, editing and rejection operations."""

from datetime import UTC, datetime
from typing import Final
from uuid import UUID

from pydantic import TypeAdapter
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.adapters.gemini import GeminiProposalGenerator, get_gemini_generator
from mapkeeper.api.schemas.store_change import (
    CreateStoreChangeProposalRequest,
    PatchStoreChangeProposalRequest,
    ProposalChange,
    StoreChangeProposalResponse,
)
from mapkeeper.core.errors import InvalidStateError, ResourceNotFoundError, StaleProposalError
from mapkeeper.core.json_types import JsonValue
from mapkeeper.models import ProposalStatus, StoreChangeProposal, StoreProfile
from mapkeeper.services.pii_masking import mask_customer_pii

PROPOSAL_NOT_FOUND_MESSAGE: Final = "요청한 변경안을 찾을 수 없습니다."
PROFILE_NOT_FOUND_MESSAGE: Final = "요청한 매장 정보를 찾을 수 없습니다."
NO_EFFECTIVE_CHANGE_MESSAGE: Final = "현재 매장 정보와 달라진 내용이 없습니다."
PROPOSAL_NOT_DRAFT_MESSAGE: Final = "이미 처리된 변경안은 수정하거나 거절할 수 없습니다."
STALE_PROPOSAL_MESSAGE: Final = "변경안의 현재 값이 최신 매장 정보와 일치하지 않습니다."
_CHANGES_ADAPTER: TypeAdapter[tuple[ProposalChange, ...]] = TypeAdapter(
    tuple[ProposalChange, ...],
)


def _changes_json(changes: tuple[ProposalChange, ...]) -> list[JsonValue]:
    """Serialize validated proposal changes to the JSONB representation."""
    return [change.model_dump(by_alias=True, mode="json") for change in changes]


def _response(proposal: StoreChangeProposal) -> StoreChangeProposalResponse:
    """Render a stored proposal through the API schemas again."""
    return StoreChangeProposalResponse(
        proposal_id=proposal.id,
        recognized_text_masked=proposal.recognized_text_masked,
        changes=_CHANGES_ADAPTER.validate_python(proposal.changes),
        status=proposal.status,
    )


def has_effective_change(changes: tuple[ProposalChange, ...]) -> bool:
    """Return whether at least one proposed value differs from its current value."""
    return any(change.current_value != change.proposed_value for change in changes)


async def _locked_proposal(session: AsyncSession, proposal_id: UUID) -> StoreChangeProposal:
    """Load one proposal while serializing all lifecycle transitions."""
    statement = (
        select(StoreChangeProposal).where(StoreChangeProposal.id == proposal_id).with_for_update()
    )
    proposal = (await session.execute(statement)).scalar_one_or_none()
    if proposal is None:
        raise ResourceNotFoundError(PROPOSAL_NOT_FOUND_MESSAGE)
    return proposal


async def create_proposal(
    session: AsyncSession,
    body: CreateStoreChangeProposalRequest,
    generator: GeminiProposalGenerator | None = None,
) -> StoreChangeProposalResponse:
    """Mask input, generate validated changes and persist a DRAFT proposal."""
    profile = await session.get(StoreProfile, body.store_profile_id)
    if profile is None:
        raise ResourceNotFoundError(PROFILE_NOT_FOUND_MESSAGE)
    selected_generator = generator if generator is not None else get_gemini_generator()
    masked_text = mask_customer_pii(body.recognized_text)
    changes = await selected_generator.generate(masked_text, profile)
    if not has_effective_change(changes):
        raise InvalidStateError(NO_EFFECTIVE_CHANGE_MESSAGE)
    proposal = StoreChangeProposal(
        store_profile_id=profile.id,
        recognized_text_masked=masked_text,
        changes=_changes_json(changes),
        status=ProposalStatus.DRAFT,
    )
    session.add(proposal)
    await session.flush()
    return _response(proposal)


async def patch_proposal(
    session: AsyncSession,
    proposal_id: UUID,
    body: PatchStoreChangeProposalRequest,
) -> StoreChangeProposalResponse:
    """Replace every change on a locked DRAFT after stale-value checking."""
    proposal = await _locked_proposal(session, proposal_id)
    if proposal.status is not ProposalStatus.DRAFT:
        raise InvalidStateError(PROPOSAL_NOT_DRAFT_MESSAGE)
    stored = _CHANGES_ADAPTER.validate_python(proposal.changes)
    stored_by_field = {change.field: change for change in stored}
    for change in body.changes:
        previous = stored_by_field.get(change.field)
        if previous is None or previous.current_value != change.current_value:
            raise StaleProposalError(STALE_PROPOSAL_MESSAGE)
    proposal.changes = _changes_json(body.changes)
    await session.flush()
    return _response(proposal)


async def reject_proposal(
    session: AsyncSession,
    proposal_id: UUID,
) -> StoreChangeProposalResponse:
    """Move a locked DRAFT proposal to REJECTED."""
    proposal = await _locked_proposal(session, proposal_id)
    if proposal.status is not ProposalStatus.DRAFT:
        raise InvalidStateError(PROPOSAL_NOT_DRAFT_MESSAGE)
    proposal.status = ProposalStatus.REJECTED
    proposal.rejected_at = datetime.now(UTC)
    await session.flush()
    return _response(proposal)
