"""Review insight endpoints shared by the home and SEO flows."""

from datetime import UTC, datetime
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Path
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from mapkeeper.api.responses import RESOURCE_ERRORS, carry_request_id, error_responses
from mapkeeper.api.schemas.common import ApiEnvelope
from mapkeeper.api.schemas.review import ReviewSummaryResponse, SourceReviewResponse
from mapkeeper.core.errors import ResourceNotFoundError
from mapkeeper.db.session import get_session
from mapkeeper.models import ApiResponseStatus, SourceReview, StoreProfile

router = APIRouter(
    prefix="/store-profiles",
    tags=["reviews"],
    dependencies=[Depends(carry_request_id)],
)

ReviewEnvelope = ApiEnvelope[ReviewSummaryResponse]
SessionDep = Annotated[AsyncSession, Depends(get_session)]
REPRESENTATIVE_REVIEW_LIMIT = 10
DEMO_REVIEW_SUMMARY = (
    "속이 꽉 찬 만두와 깊고 깔끔한 국물 맛에 대한 칭찬이 가장 많아요. "
    "직원의 친절한 응대와 넉넉한 양도 좋은 반응을 얻고 있어요."
)
DEMO_REVIEW_KEYWORDS = ("속이알참", "친절함", "주차편함")
STORE_NOT_FOUND_MESSAGE = "매장 정보를 찾을 수 없습니다."


def _success(data: ReviewSummaryResponse) -> ReviewEnvelope:
    """Wrap a review summary in the common success envelope."""
    return ReviewEnvelope(
        success=True,
        status=ApiResponseStatus.SUCCESS,
        data=data,
        error=None,
        timestamp=datetime.now(UTC),
    )


@router.get(
    "/{storeProfileId}/reviews/summary",
    responses=error_responses(*RESOURCE_ERRORS),
    summary="Get the shared review summary for a store",
)
async def get_review_summary(
    store_profile_id: Annotated[UUID, Path(alias="storeProfileId")],
    session: SessionDep,
) -> ReviewEnvelope:
    """Return one deterministic review summary for both insight and SEO screens."""
    if await session.get(StoreProfile, store_profile_id) is None:
        raise ResourceNotFoundError(STORE_NOT_FOUND_MESSAGE)

    review_count = int(
        (
            await session.execute(
                select(func.count(SourceReview.id)).where(
                    SourceReview.store_profile_id == store_profile_id,
                )
            )
        ).scalar_one()
    )
    reviews = (
        (
            await session.execute(
                select(SourceReview)
                .where(SourceReview.store_profile_id == store_profile_id)
                .order_by(SourceReview.created_at, SourceReview.id)
                .limit(REPRESENTATIVE_REVIEW_LIMIT)
            )
        )
        .scalars()
        .all()
    )
    data = ReviewSummaryResponse(
        store_profile_id=store_profile_id,
        review_count=review_count,
        summary=DEMO_REVIEW_SUMMARY if review_count else "아직 분석할 리뷰가 없어요.",
        keywords=DEMO_REVIEW_KEYWORDS if review_count else (),
        source_reviews=tuple(
            SourceReviewResponse(
                id=review.id,
                store_profile_id=review.store_profile_id,
                body_masked=review.body_masked,
                created_at=review.created_at,
            )
            for review in reviews
        ),
    )
    return _success(data)


__all__ = ["router"]
