from typing import TYPE_CHECKING, Final
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mapkeeper.core.json_types import JsonValue
from mapkeeper.models.base import (
    Base,
    TableArgs,
    TimestampMixin,
    TimestampTz,
    UuidPk,
    UuidValue,
    pg_enum,
)
from mapkeeper.models.enums import ContentGenerationStatus, ContentPurpose, Platform

if TYPE_CHECKING:
    from mapkeeper.models.store import StoreProfile

BRIEF_TEXT_MAX_LENGTH: Final = 500
DRAFT_TEXT_MAX_LENGTH: Final = 750
POSITIVE_REVISION_CONSTRAINT: Final = "positive_revision"
POSITIVE_REVISION_SQL: Final = "revision >= 1"


class ContentGeneration(TimestampMixin, Base):
    """Common UC2 input and the approval unit grouping all three platform results."""

    __tablename__: str = "content_generation"
    __table_args__: TableArgs = (
        CheckConstraint(POSITIVE_REVISION_SQL, name=POSITIVE_REVISION_CONSTRAINT),
    )

    id: Mapped[UuidPk] = mapped_column()
    store_profile_id: Mapped[UuidValue] = mapped_column(
        ForeignKey("store_profile.id", ondelete="CASCADE"),
        index=True,
    )
    brief_text: Mapped[str] = mapped_column(String(BRIEF_TEXT_MAX_LENGTH))
    purpose: Mapped[ContentPurpose] = mapped_column(
        pg_enum(ContentPurpose, "content_purpose"),
        default=ContentPurpose.INTRODUCTION,
        server_default=ContentPurpose.INTRODUCTION.value,
    )
    seed_keywords: Mapped[list[str]] = mapped_column(postgresql.ARRAY(Text()))
    source_review_ids: Mapped[list[UUID] | None] = mapped_column(
        postgresql.ARRAY(postgresql.UUID(as_uuid=True))
    )
    status: Mapped[ContentGenerationStatus] = mapped_column(
        pg_enum(ContentGenerationStatus, "content_generation_status")
    )
    revision: Mapped[int] = mapped_column(Integer(), default=1, server_default=text("1"))
    approved_at: Mapped[TimestampTz | None] = mapped_column()
    rejected_at: Mapped[TimestampTz | None] = mapped_column()

    store_profile: Mapped["StoreProfile"] = relationship(lazy="raise")
    drafts: Mapped[list["LocalSEOContent"]] = relationship(
        back_populates="content_generation",
        cascade="all, delete-orphan",
        lazy="raise",
    )


class LocalSEOContent(TimestampMixin, Base):
    """System-generated copy and keywords for exactly one platform."""

    __tablename__: str = "local_seo_content"
    __table_args__: TableArgs = (UniqueConstraint("content_generation_id", "platform"),)

    id: Mapped[UuidPk] = mapped_column()
    content_generation_id: Mapped[UuidValue] = mapped_column(
        ForeignKey("content_generation.id", ondelete="CASCADE"),
        index=True,
    )
    platform: Mapped[Platform] = mapped_column(pg_enum(Platform, "platform"))
    draft_text: Mapped[str] = mapped_column(String(DRAFT_TEXT_MAX_LENGTH))
    keywords: Mapped[list[str]] = mapped_column(postgresql.ARRAY(Text()))
    content_rules: Mapped[list[JsonValue]] = mapped_column(postgresql.JSONB())

    content_generation: Mapped[ContentGeneration] = relationship(
        back_populates="drafts",
        lazy="raise",
    )
