from datetime import datetime
from typing import ClassVar, Final, Generic, Self, TypeVar

from pydantic import BaseModel, ConfigDict, model_validator
from pydantic.alias_generators import to_camel
from pydantic_core import PydanticCustomError

from mapkeeper.models.enums import ApiResponseStatus

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


class ApiError(ApiSchema):
    """Safe error body returned at the MapKeeper API boundary."""

    code: str
    message: str
    details: tuple[ValidationDetail, ...] = ()
    retryable: bool | None = None


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
