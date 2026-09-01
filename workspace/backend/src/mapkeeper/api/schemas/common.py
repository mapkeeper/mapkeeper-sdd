from datetime import datetime
from typing import Annotated, ClassVar, Final, Generic, Self, TypeVar

from pydantic import BaseModel, ConfigDict, StringConstraints, model_validator
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

from mapkeeper.models.enums import ApiErrorCode, ApiResponseStatus, ProposalFailureReason

IDEMPOTENCY_KEY_MAX_LENGTH: Final = 128
IDEMPOTENCY_KEY_PATTERN: Final = r"^[A-Za-z0-9._:-]+$"
IdempotencyKey = Annotated[
    str,
    StringConstraints(
        min_length=1,
        max_length=IDEMPOTENCY_KEY_MAX_LENGTH,
        pattern=IDEMPOTENCY_KEY_PATTERN,
    ),
]

INVALID_SUCCESS_ENVELOPE: Final = "invalid_success_envelope"
INVALID_SUCCESS_ENVELOPE_MESSAGE: Final = (
    "successful responses require data and cannot include an error"
)
INVALID_FAILURE_ENVELOPE: Final = "invalid_failure_envelope"
INVALID_FAILURE_ENVELOPE_MESSAGE: Final = (
    "failed responses require an error and cannot include data"
)


class ApiSchema(BaseModel):
    """Immutable API boundary model using the contract's camel-case fields."""

    model_config: ClassVar[ConfigDict] = ConfigDict(
        alias_generator=to_camel,
        extra="forbid",
        frozen=True,
        populate_by_name=True,
        str_strip_whitespace=True,
    )


class ValidationDetail(ApiSchema):
    """Machine-readable validation failure for one request field."""

    field: str
    reason: str


class ProposalFailure(ApiSchema):
    """Why a request was refused, and what the caller can do about it.

    ``code`` says which contract rule was broken and ``message`` says it in one
    sentence, but neither tells the screen what to *offer*. A refusal the owner
    cannot act on ends the task: they hear "다시 확인해 주세요", have no idea what
    to change, and the sentence they spoke is gone. So every refusal carries the
    machine-readable ``reason``, the sentence itself, and a concrete way to say it
    again.

    ``recognizedTextMasked`` is the submitted sentence after customer PII has been
    removed, which is the same value a successful proposal echoes back. It is here
    so the screen can put the owner's own words back in the box instead of asking
    them to start over.
    """

    reason: ProposalFailureReason
    message: str
    guidance: str
    retry: str
    examples: tuple[str, ...] = ()
    recognized_text_masked: str | None = None


class ApiError(ApiSchema):
    """Safe error body returned at the MapKeeper API boundary."""

    code: ApiErrorCode
    message: str
    details: tuple[ValidationDetail, ...] = ()
    retryable: bool | None = None
    # Present when the endpoint can name what the caller has to change. Absent
    # everywhere else, so an existing client keeps parsing the envelope it knows.
    failure: ProposalFailure | None = None


DataT = TypeVar("DataT")


class ApiEnvelope(ApiSchema, Generic[DataT]):
    """Common response envelope shared by all MapKeeper endpoints."""

    success: bool
    status: ApiResponseStatus
    data: DataT | None
    error: ApiError | None
    timestamp: datetime

    @model_validator(mode="after")
    def _validate_result_shape(self) -> Self:
        if self.success and (self.data is None or self.error is not None):
            raise PydanticCustomError(
                INVALID_SUCCESS_ENVELOPE,
                INVALID_SUCCESS_ENVELOPE_MESSAGE,
            )
        if not self.success and (self.data is not None or self.error is None):
            raise PydanticCustomError(
                INVALID_FAILURE_ENVELOPE,
                INVALID_FAILURE_ENVELOPE_MESSAGE,
            )
        return self


class ErrorEnvelope(ApiEnvelope[None]):
    """Failure envelope: ``success`` is false, ``data`` is null and ``error`` is set."""
