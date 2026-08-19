from datetime import date
from typing import Final

from sqlalchemy import CheckConstraint, Date, ForeignKey, String, Text
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column

from mapkeeper.core.json_types import JsonObject, JsonValue
from mapkeeper.models.base import (
    Base,
    TableArgs,
    TimestampMixin,
    TimestampTz,
    UuidPk,
    UuidValue,
    pg_enum,
)
from mapkeeper.models.enums import ProposalStatus

RECOGNIZED_TEXT_MAX_LENGTH: Final = 500
REPRESENTATIVE_MENU_NAME_MAX_LENGTH: Final = 50
PARKING_INFO_MAX_LENGTH: Final = 50
TEMPORARY_CLOSURE_RANGE_CONSTRAINT: Final = "temporary_closure_range"
TEMPORARY_CLOSURE_RANGE_SQL: Final = """
(temporary_closure_start_date IS NULL AND temporary_closure_end_date IS NULL)
OR (
    temporary_closure_start_date IS NOT NULL
    AND temporary_closure_end_date IS NOT NULL
    AND temporary_closure_end_date >= temporary_closure_start_date
)
"""


class StoreProfile(TimestampMixin, Base):
    """Latest store target state the user has approved."""

    __tablename__: str = "store_profile"
    __table_args__: TableArgs = (
        CheckConstraint(TEMPORARY_CLOSURE_RANGE_SQL, name=TEMPORARY_CLOSURE_RANGE_CONSTRAINT),
    )

    id: Mapped[UuidPk] = mapped_column()
    store_name: Mapped[str] = mapped_column(String())
    public_address: Mapped[str] = mapped_column(Text())
    business_hours: Mapped[JsonObject] = mapped_column(postgresql.JSONB())
    temporary_closure_start_date: Mapped[date | None] = mapped_column(Date())
    temporary_closure_end_date: Mapped[date | None] = mapped_column(Date())
    representative_menu_name: Mapped[str] = mapped_column(
        String(REPRESENTATIVE_MENU_NAME_MAX_LENGTH)
    )
    representative_phone: Mapped[str] = mapped_column(String())
    parking_info: Mapped[str | None] = mapped_column(String(PARKING_INFO_MAX_LENGTH))
    platform_account_refs: Mapped[JsonObject] = mapped_column(postgresql.JSONB())


class StoreChangeProposal(TimestampMixin, Base):
    """Masked recognized sentence and its validated structured changes."""

    __tablename__: str = "store_change_proposal"

    id: Mapped[UuidPk] = mapped_column()
    store_profile_id: Mapped[UuidValue] = mapped_column(
        ForeignKey("store_profile.id", ondelete="CASCADE"),
        index=True,
    )
    recognized_text_masked: Mapped[str] = mapped_column(String(RECOGNIZED_TEXT_MAX_LENGTH))
    changes: Mapped[list[JsonValue]] = mapped_column(postgresql.JSONB())
    status: Mapped[ProposalStatus] = mapped_column(pg_enum(ProposalStatus, "proposal_status"))
    approved_at: Mapped[TimestampTz | None] = mapped_column()
    rejected_at: Mapped[TimestampTz | None] = mapped_column()
