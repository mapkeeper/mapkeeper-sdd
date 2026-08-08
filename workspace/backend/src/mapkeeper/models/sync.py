from typing import TYPE_CHECKING, Final

from sqlalchemy import (
    CHAR,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from mapkeeper.models.base import (
    Base,
    TableArgs,
    TimestampMixin,
    TimestampTz,
    UuidPk,
    UuidValue,
    pg_enum,
)
from mapkeeper.models.enums import (
    Platform,
    PlatformSyncTaskStatus,
    SyncJobStatus,
    SyncSourceType,
)

if TYPE_CHECKING:
    from mapkeeper.models.store import StoreProfile

IDEMPOTENCY_KEY_MAX_LENGTH: Final = 128
REQUEST_HASH_LENGTH: Final = 64
MAX_ATTEMPT_COUNT: Final = 3
SOURCE_EXCLUSIVITY_CONSTRAINT: Final = "source_exclusivity"
SOURCE_EXCLUSIVITY_SQL: Final = """
(
    source_type = 'STORE_CHANGE_PROPOSAL'
    AND store_change_proposal_id IS NOT NULL
    AND content_generation_id IS NULL
)
OR (
    source_type = 'CONTENT_GENERATION'
    AND content_generation_id IS NOT NULL
    AND store_change_proposal_id IS NULL
)
"""
ATTEMPT_COUNT_RANGE_CONSTRAINT: Final = "attempt_count_range"
ATTEMPT_COUNT_RANGE_SQL: Final = f"attempt_count >= 0 AND attempt_count <= {MAX_ATTEMPT_COUNT}"


class SyncJob(TimestampMixin, Base):
    """Full processing state of one UC1 or UC2 approval."""

    __tablename__: str = "sync_job"
    __table_args__: TableArgs = (
        CheckConstraint(SOURCE_EXCLUSIVITY_SQL, name=SOURCE_EXCLUSIVITY_CONSTRAINT),
        UniqueConstraint("approved_by", "idempotency_key"),
    )

    id: Mapped[UuidPk] = mapped_column()
    store_profile_id: Mapped[UuidValue] = mapped_column(
        ForeignKey("store_profile.id", ondelete="CASCADE"),
        index=True,
    )
    source_type: Mapped[SyncSourceType] = mapped_column(pg_enum(SyncSourceType, "sync_source_type"))
    store_change_proposal_id: Mapped[UuidValue | None] = mapped_column(
        ForeignKey("store_change_proposal.id", ondelete="RESTRICT"),
        index=True,
    )
    content_generation_id: Mapped[UuidValue | None] = mapped_column(
        ForeignKey("content_generation.id", ondelete="RESTRICT"),
        index=True,
    )
    status: Mapped[SyncJobStatus] = mapped_column(pg_enum(SyncJobStatus, "sync_job_status"))
    approved_at: Mapped[TimestampTz] = mapped_column()
    approved_by: Mapped[UuidValue] = mapped_column()
    idempotency_key: Mapped[str] = mapped_column(String(IDEMPOTENCY_KEY_MAX_LENGTH))
    idempotency_request_hash: Mapped[str] = mapped_column(CHAR(REQUEST_HASH_LENGTH))

    store_profile: Mapped["StoreProfile"] = relationship(lazy="raise")
    platform_tasks: Mapped[list["PlatformSyncTask"]] = relationship(
        back_populates="sync_job",
        cascade="all, delete-orphan",
        lazy="raise",
    )


class PlatformSyncTask(TimestampMixin, Base):
    """Execution, error and retry state of exactly one platform."""

    __tablename__: str = "platform_sync_task"
    __table_args__: TableArgs = (
        CheckConstraint(ATTEMPT_COUNT_RANGE_SQL, name=ATTEMPT_COUNT_RANGE_CONSTRAINT),
        UniqueConstraint("sync_job_id", "platform"),
    )

    id: Mapped[UuidPk] = mapped_column()
    sync_job_id: Mapped[UuidValue] = mapped_column(
        ForeignKey("sync_job.id", ondelete="CASCADE"),
        index=True,
    )
    platform: Mapped[Platform] = mapped_column(pg_enum(Platform, "platform"))
    status: Mapped[PlatformSyncTaskStatus] = mapped_column(
        pg_enum(PlatformSyncTaskStatus, "platform_sync_task_status")
    )
    attempt_count: Mapped[int] = mapped_column(Integer(), default=0, server_default=text("0"))
    next_retry_at: Mapped[TimestampTz | None] = mapped_column()
    error_code: Mapped[str | None] = mapped_column(Text())
    error_message: Mapped[str | None] = mapped_column(Text())
    retryable: Mapped[bool | None] = mapped_column(Boolean())
    last_attempt_at: Mapped[TimestampTz | None] = mapped_column()

    sync_job: Mapped[SyncJob] = relationship(
        back_populates="platform_tasks",
        lazy="raise",
    )
