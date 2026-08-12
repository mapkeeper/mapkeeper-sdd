"""Shared review summary endpoint checks."""

from uuid import UUID, uuid4

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.api.routes.review import get_review_summary
from mapkeeper.core.errors import ResourceNotFoundError
from mapkeeper.db.seed import DEMO_STORE_PROFILE_ID, seed
from mapkeeper.models import ApiResponseStatus

pytestmark = pytest.mark.asyncio


async def test_review_summary_returns_all_count_and_representative_rows(
    db_session: AsyncSession,
) -> None:
    # Given: the deterministic demo store has 128 masked reviews.
    _ = await seed(db_session)

    # When: the shared review summary is requested.
    envelope = await get_review_summary(DEMO_STORE_PROFILE_ID, db_session)

    # Then: the count is complete while the response remains within the ten-id API cap.
    assert envelope.status is ApiResponseStatus.SUCCESS
    assert envelope.data is not None
    assert envelope.data.review_count == 128
    assert len(envelope.data.source_reviews) == 10
    assert all(
        review.store_profile_id == DEMO_STORE_PROFILE_ID for review in envelope.data.source_reviews
    )


async def test_review_summary_rejects_an_unknown_store(db_session: AsyncSession) -> None:
    # Given: an id that is not present in the database.
    unknown_store_id = UUID(str(uuid4()))

    # When / Then: the shared endpoint uses the contract's resource error.
    with pytest.raises(ResourceNotFoundError):
        _ = await get_review_summary(unknown_store_id, db_session)
