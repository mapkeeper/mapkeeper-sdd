"""Which adapter serves which platform.

The MVP ships an adapter that accepts every update, so the approval, status and
retry pipeline can be exercised end to end before the Google, Naver and Kakao
clients exist. Registering the real adapters replaces it without touching any
caller, which is the point of the Protocol.
"""

from dataclasses import dataclass
from typing import Final

from mapkeeper.adapters.base import PlatformAdapter, SyncRequest
from mapkeeper.core.logging import get_logger
from mapkeeper.models import Platform

logger = get_logger(__name__)


@dataclass(frozen=True)
class AcceptingAdapter:
    """Placeholder adapter that reports success without calling anything outside."""

    platform: Platform

    async def publish(self, request: SyncRequest) -> None:
        """Accept the update and record that no external call was made."""
        logger.info(
            "no %s client configured; accepting syncJobId=%s without an external call",
            self.platform.value,
            request.sync_job_id,
        )


_ADAPTERS: Final[dict[Platform, PlatformAdapter]] = {
    platform: AcceptingAdapter(platform) for platform in Platform
}


def get_adapter(platform: Platform) -> PlatformAdapter:
    """Return the adapter registered for one platform."""
    return _ADAPTERS[platform]
