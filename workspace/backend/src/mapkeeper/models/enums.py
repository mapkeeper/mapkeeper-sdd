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
class ContentPurpose(StrEnum):
    """User-facing purpose that selects the copy generation rules."""

    INTRODUCTION = "INTRODUCTION"
    NEWS = "NEWS"


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


@unique
class ApiErrorCode(StrEnum):
    """Error raised by the MapKeeper API itself, never by an external platform."""

    MALFORMED_REQUEST = "MALFORMED_REQUEST"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    RESOURCE_NOT_FOUND = "RESOURCE_NOT_FOUND"
    INVALID_STATE = "INVALID_STATE"
    STALE_PROPOSAL = "STALE_PROPOSAL"
    IDEMPOTENCY_CONFLICT = "IDEMPOTENCY_CONFLICT"
    NO_RETRYABLE_TASKS = "NO_RETRYABLE_TASKS"
    REQUEST_RATE_LIMITED = "REQUEST_RATE_LIMITED"
    AUTHENTICATION_REQUIRED = "AUTHENTICATION_REQUIRED"
    INTERNAL_SERVER_ERROR = "INTERNAL_SERVER_ERROR"


@unique
class ProposalFailureReason(StrEnum):
    """Why one UC1 sentence did not become a proposal.

    The user-facing message alone is not enough for the screen to act on: it
    cannot tell "say a clock time" from "say a date" from "name one menu", so it
    could only ever show the same retry box. This is the machine-readable half of
    that refusal, and every value names a distinct thing the owner has to change
    about what they said.
    """

    AMBIGUOUS_TIME = "AMBIGUOUS_TIME"
    AMBIGUOUS_DATE = "AMBIGUOUS_DATE"
    UNREADABLE_DATE_RANGE = "UNREADABLE_DATE_RANGE"
    INVALID_DATE = "INVALID_DATE"
    MULTIPLE_MENU_CANDIDATES = "MULTIPLE_MENU_CANDIDATES"
    UNSUPPORTED_FIELD = "UNSUPPORTED_FIELD"
    NO_CHANGE_FOUND = "NO_CHANGE_FOUND"
    NO_EFFECTIVE_CHANGE = "NO_EFFECTIVE_CHANGE"


@unique
class PlatformErrorCode(StrEnum):
    """Normalized failure reported by one external platform adapter."""

    API_TIMEOUT = "API_TIMEOUT"
    RATE_LIMITED = "RATE_LIMITED"
    PLATFORM_SERVER_ERROR = "PLATFORM_SERVER_ERROR"
    AUTHENTICATION_ERROR = "AUTHENTICATION_ERROR"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    PLATFORM_VALIDATION_ERROR = "PLATFORM_VALIDATION_ERROR"


RETRYABLE_PLATFORM_ERROR_CODES: frozenset[PlatformErrorCode] = frozenset(
    {
        PlatformErrorCode.API_TIMEOUT,
        PlatformErrorCode.RATE_LIMITED,
        PlatformErrorCode.PLATFORM_SERVER_ERROR,
    }
)
