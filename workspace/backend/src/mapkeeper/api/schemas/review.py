"""Review summary response schemas."""

from datetime import datetime
from uuid import UUID

from mapkeeper.api.schemas.common import ApiSchema


class SourceReviewResponse(ApiSchema):
    """One masked source review that can be shown or cited by a generation."""

    id: UUID
    store_profile_id: UUID
    body_masked: str
    created_at: datetime


class ReviewSummaryResponse(ApiSchema):
    """Shared review data consumed by the home insight and SEO flows."""

    store_profile_id: UUID
    review_count: int
    summary: str
    keywords: tuple[str, ...]
    source_reviews: tuple[SourceReviewResponse, ...]
