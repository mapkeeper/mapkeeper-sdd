from datetime import date
from typing import Annotated, Final, Literal, Self
from uuid import UUID

from pydantic import Field, StringConstraints, model_validator
from pydantic_core import PydanticCustomError

from mapkeeper.api.schemas.common import ApiSchema
from mapkeeper.models.enums import ProposalStatus, SyncJobStatus

RECOGNIZED_TEXT_MAX_LENGTH: Final = 500
MENU_NAME_MAX_LENGTH: Final = 50

NonEmptyText = Annotated[str, StringConstraints(min_length=1, strip_whitespace=True)]
RecognizedText = Annotated[
    str,
    StringConstraints(min_length=1, max_length=RECOGNIZED_TEXT_MAX_LENGTH, strip_whitespace=True),
]
MenuName = Annotated[
    str,
    StringConstraints(min_length=1, max_length=MENU_NAME_MAX_LENGTH, strip_whitespace=True),
]
HourMinute = Annotated[
    str,
    StringConstraints(pattern=r"^(?:[01]\d|2[0-3]):[0-5]\d$", strict=True),
]
INVALID_TEMPORARY_CLOSURE_RANGE: Final = "invalid_temporary_closure_range"
INVALID_TEMPORARY_CLOSURE_RANGE_MESSAGE: Final = "endDate must be on or after startDate"


class BusinessHoursValue(ApiSchema):
    """Opening and closing time in 24-hour HH:mm form."""

    open: HourMinute
    close: HourMinute


class TemporaryClosureValue(ApiSchema):
    """Inclusive temporary closure date range."""

    start_date: date
    end_date: date

    @model_validator(mode="after")
    def _validate_date_order(self) -> Self:
        if self.end_date < self.start_date:
            raise PydanticCustomError(
                INVALID_TEMPORARY_CLOSURE_RANGE,
                INVALID_TEMPORARY_CLOSURE_RANGE_MESSAGE,
            )
        return self


class BusinessHoursChange(ApiSchema):
    """Typed business-hours proposal change."""

    field: Literal["businessHours"]
    current_value: BusinessHoursValue
    proposed_value: BusinessHoursValue


class TemporaryClosureChange(ApiSchema):
    """Typed temporary-closure proposal change."""

    field: Literal["temporaryClosure"]
    current_value: TemporaryClosureValue | None
    proposed_value: TemporaryClosureValue


class RepresentativeMenuNameChange(ApiSchema):
    """Typed representative-menu proposal change."""

    field: Literal["representativeMenuName"]
    current_value: MenuName
    proposed_value: MenuName


ProposalChange = Annotated[
    BusinessHoursChange | TemporaryClosureChange | RepresentativeMenuNameChange,
    Field(discriminator="field"),
]


class CreateStoreChangeProposalRequest(ApiSchema):
    """Recognized text submitted to create a store change proposal."""

    store_profile_id: UUID
    recognized_text: RecognizedText
    locale: Literal["ko-KR"]


class PatchStoreChangeProposalRequest(ApiSchema):
    """Validated proposal changes replacing the current draft changes."""

    changes: Annotated[tuple[ProposalChange, ...], Field(min_length=1)]


class StoreChangeProposalResponse(ApiSchema):
    """Store change proposal returned for review."""

    proposal_id: UUID
    recognized_text_masked: RecognizedText
    changes: Annotated[tuple[ProposalChange, ...], Field(min_length=1)]
    status: ProposalStatus


class StoreChangeProposalApprovalResponse(ApiSchema):
    """Proposal approval and synchronization handoff."""

    proposal_id: UUID
    proposal_status: ProposalStatus
    sync_job_id: UUID
    status: SyncJobStatus
    status_url: NonEmptyText
