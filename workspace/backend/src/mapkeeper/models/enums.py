from enum import StrEnum, unique


@unique
class ApiResponseStatus(StrEnum):
    """API request processing status."""

    SUCCESS = "SUCCESS"
    PROCESSING = "PROCESSING"
    FAILED = "FAILED"


@unique
class Platform(StrEnum):
    """Supported external business profile platform."""

    GOOGLE = "google"
    NAVER = "naver"
    KAKAO = "kakao"


@unique
class ProposalStatus(StrEnum):
    """Store change proposal lifecycle status."""

    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


@unique
class ContentGenerationStatus(StrEnum):
    """SEO content generation lifecycle status."""

    DRAFT = "DRAFT"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


@unique
class SyncJobStatus(StrEnum):
    """Aggregate three-platform synchronization status."""

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    PARTIAL_SUCCESS = "PARTIAL_SUCCESS"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    RETRYING = "RETRYING"


@unique
class PlatformSyncTaskStatus(StrEnum):
    """Single-platform synchronization status."""

    PENDING = "PENDING"
    PROCESSING = "PROCESSING"
    SUCCESS = "SUCCESS"
    FAILED = "FAILED"
    RETRYING = "RETRYING"


@unique
class SyncSourceType(StrEnum):
    """Domain source approved to create a synchronization job."""

    STORE_CHANGE_PROPOSAL = "STORE_CHANGE_PROPOSAL"
    CONTENT_GENERATION = "CONTENT_GENERATION"
