"""Adapter boundaries shared across modules, kept here to avoid import cycles."""

from typing import Protocol

from mapkeeper.api.schemas.store_change import ProposalChange
from mapkeeper.models import StoreProfile


class GeminiProposalGenerator(Protocol):
    """Turn one masked sentence into validated UC1 changes."""

    async def generate(
        self,
        masked_text: str,
        profile: StoreProfile,
    ) -> tuple[ProposalChange, ...]:
        """Return the changes the sentence describes."""
        ...


__all__ = ["GeminiProposalGenerator"]
