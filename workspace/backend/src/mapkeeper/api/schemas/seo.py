from collections.abc import Sequence
from typing import Annotated, Final, Self
from uuid import UUID

from pydantic import Field, StringConstraints, field_validator, model_validator
from pydantic_core import PydanticCustomError

from mapkeeper.api.schemas.common import ApiSchema
from mapkeeper.models.enums import ContentGenerationStatus, Platform, SyncJobStatus

BRIEF_TEXT_MAX_LENGTH: Final = 500
DRAFT_TEXT_MAX_LENGTH: Final = 750
KEYWORD_MAX_LENGTH: Final = 30
SEED_KEYWORDS_MIN: Final = 1
SEED_KEYWORDS_MAX: Final = 5
PLATFORM_KEYWORDS_MIN: Final = 1
PLATFORM_KEYWORDS_MAX: Final = 10
SOURCE_REVIEW_IDS_MAX: Final = 10

NonEmptyText = Annotated[str, StringConstraints(min_length=1, strip_whitespace=True)]
BriefText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=BRIEF_TEXT_MAX_LENGTH, strip_whitespace=True),
]
DraftText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=DRAFT_TEXT_MAX_LENGTH, strip_whitespace=True),
]
Keyword = Annotated[
    str,
    StringConstraints(min_length=1, max_length=KEYWORD_MAX_LENGTH, strip_whitespace=True),
]
SeedKeywords = Annotated[
    tuple[Keyword, ...],
    Field(min_length=SEED_KEYWORDS_MIN, max_length=SEED_KEYWORDS_MAX),
]
PlatformKeywords = Annotated[
    tuple[Keyword, ...],
    Field(min_length=PLATFORM_KEYWORDS_MIN, max_length=PLATFORM_KEYWORDS_MAX),
]
SourceReviewIds = Annotated[tuple[UUID, ...], Field(max_length=SOURCE_REVIEW_IDS_MAX)]

REQUIRED_PLATFORMS: Final = frozenset({Platform.GOOGLE, Platform.NAVER, Platform.KAKAO})
INVALID_PLATFORM_COVERAGE: Final = "invalid_platform_coverage"
INVALID_PLATFORM_COVERAGE_MESSAGE: Final = (
    "drafts must contain exactly one result for each supported platform"
)
INVALID_APPROVED_PLATFORMS: Final = "invalid_approved_platforms"
INVALID_APPROVED_PLATFORMS_MESSAGE: Final = (
    "approvedPlatforms must contain every supported platform exactly once"
)
DUPLICATE_SOURCE_REVIEW_IDS: Final = "duplicate_source_review_ids"
DUPLICATE_SOURCE_REVIEW_IDS_MESSAGE: Final = "sourceReviewIds must not repeat a review"


def normalize_keywords(values: Sequence[str]) -> tuple[str, ...]:
    """Trim each keyword, drop a leading ``#`` and collapse duplicates in input order."""
    normalized: list[str] = []
    for value in values:
        cleaned = value.strip().removeprefix("#").strip()
        if cleaned and cleaned not in normalized:
            normalized.append(cleaned)
    return tuple(normalized)


class ContentGenerationInput(ApiSchema):
    """Common user input used to generate all three platform results."""

    brief_text: BriefText
    seed_keywords: SeedKeywords
    source_review_ids: SourceReviewIds | None = None

    @field_validator("seed_keywords", mode="before")
    @classmethod
    def _normalize_seed_keywords(cls, value: object) -> object:
        if isinstance(value, Sequence) and not isinstance(value, str):
            return normalize_keywords([item for item in value if isinstance(item, str)])
        return value

    @model_validator(mode="after")
    def _reject_duplicate_source_reviews(self) -> Self:
        ids = self.source_review_ids
        if ids is not None and len(set(ids)) != len(ids):
            raise PydanticCustomError(
                DUPLICATE_SOURCE_REVIEW_IDS,
                DUPLICATE_SOURCE_REVIEW_IDS_MESSAGE,
            )
        return self


class CreateContentGenerationRequest(ContentGenerationInput):
    """Request to create one three-platform content generation."""

    store_profile_id: UUID


class RegenerateContentGenerationRequest(ContentGenerationInput):
    """Updated common input used to replace all platform results."""


class PlatformContentResult(ApiSchema):
    """Generated copy and keywords for exactly one platform."""

    draft_id: UUID
    platform: Platform
    draft_text: DraftText
    keywords: PlatformKeywords
    content_rules: tuple[NonEmptyText, ...]

    @field_validator("keywords", mode="before")
    @classmethod
    def _normalize_keywords(cls, value: object) -> object:
        if isinstance(value, Sequence) and not isinstance(value, str):
            return normalize_keywords([item for item in value if isinstance(item, str)])
        return value


class ContentGenerationResponse(ApiSchema):
    """Generation-level state and its three platform results."""

    generation_id: UUID
    status: ContentGenerationStatus
    revision: Annotated[int, Field(ge=1)]
    drafts: Annotated[tuple[PlatformContentResult, ...], Field(min_length=3, max_length=3)]

    @model_validator(mode="after")
    def _validate_platform_coverage(self) -> Self:
        platforms = frozenset(draft.platform for draft in self.drafts)
        if platforms != REQUIRED_PLATFORMS:
            raise PydanticCustomError(
                INVALID_PLATFORM_COVERAGE,
                INVALID_PLATFORM_COVERAGE_MESSAGE,
            )
        return self


class ContentGenerationApprovalResponse(ApiSchema):
    """Generation approval and synchronization handoff."""

    generation_id: UUID
    generation_status: ContentGenerationStatus
    approved_platforms: Annotated[tuple[Platform, ...], Field(min_length=3, max_length=3)]
    sync_job_id: UUID
    status: SyncJobStatus
    status_url: NonEmptyText

    @model_validator(mode="after")
    def _validate_approved_platforms(self) -> Self:
        platforms = frozenset(self.approved_platforms)
        if platforms != REQUIRED_PLATFORMS:
            raise PydanticCustomError(
                INVALID_APPROVED_PLATFORMS,
                INVALID_APPROVED_PLATFORMS_MESSAGE,
            )
        return self
