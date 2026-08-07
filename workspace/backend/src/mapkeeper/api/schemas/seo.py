from typing import Annotated, Final, Self
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from mapkeeper.api.schemas.common import ApiSchema
from mapkeeper.models.enums import ContentGenerationStatus, Platform, SyncJobStatus

NonEmptyText = Annotated[str, StringConstraints(min_length=1, strip_whitespace=True)]
NonEmptyTextItems = Annotated[tuple[NonEmptyText, ...], Field(min_length=1)]
REQUIRED_PLATFORMS: Final = frozenset({Platform.GOOGLE, Platform.NAVER, Platform.KAKAO})
INVALID_PLATFORM_COVERAGE: Final = "invalid_platform_coverage"
INVALID_PLATFORM_COVERAGE_MESSAGE: Final = (
    "drafts must contain exactly one result for each supported platform"
)
INVALID_APPROVED_PLATFORMS: Final = "invalid_approved_platforms"
INVALID_APPROVED_PLATFORMS_MESSAGE: Final = (
    "approvedPlatforms must contain every supported platform exactly once"
)


class ContentGenerationInput(ApiSchema):
    """Common user input used to generate all three platform results."""

    brief_text: NonEmptyText
    seed_keywords: NonEmptyTextItems
    source_review_ids: tuple[UUID, ...] | None = None


class CreateContentGenerationRequest(ContentGenerationInput):
    """Request to create one three-platform content generation."""

    store_profile_id: UUID


class RegenerateContentGenerationRequest(ContentGenerationInput):
    """Updated common input used to replace all platform results."""


class PlatformContentResult(ApiSchema):
    """Generated copy and keywords for exactly one platform."""

    draft_id: UUID
    platform: Platform
    draft_text: NonEmptyText
    keywords: NonEmptyTextItems
    content_rules: tuple[NonEmptyText, ...]


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
