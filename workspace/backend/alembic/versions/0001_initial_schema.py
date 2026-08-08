"""Initial schema.

Revision ID: 0001
Revises:
Create Date: 2026-08-08

Creates the MVP v0.2 schema: the approved store target state, UC1 proposals,
UC2 generations with their three platform results, and the synchronization
job and per-platform task tables.

"""

from collections.abc import Sequence
from typing import Final

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PLATFORM: Final = "platform"
PROPOSAL_STATUS: Final = "proposal_status"
CONTENT_GENERATION_STATUS: Final = "content_generation_status"
SYNC_JOB_STATUS: Final = "sync_job_status"
PLATFORM_SYNC_TASK_STATUS: Final = "platform_sync_task_status"
SYNC_SOURCE_TYPE: Final = "sync_source_type"

ENUM_VALUES: Final[dict[str, tuple[str, ...]]] = {
    PLATFORM: ("google", "naver", "kakao"),
    PROPOSAL_STATUS: ("DRAFT", "APPROVED", "REJECTED"),
    CONTENT_GENERATION_STATUS: ("DRAFT", "APPROVED", "REJECTED"),
    SYNC_JOB_STATUS: (
        "PENDING",
        "PROCESSING",
        "PARTIAL_SUCCESS",
        "SUCCESS",
        "FAILED",
        "RETRYING",
    ),
    PLATFORM_SYNC_TASK_STATUS: (
        "PENDING",
        "PROCESSING",
        "SUCCESS",
        "FAILED",
        "RETRYING",
    ),
    SYNC_SOURCE_TYPE: ("STORE_CHANGE_PROPOSAL", "CONTENT_GENERATION"),
}

TABLES: Final[tuple[str, ...]] = (
    "platform_sync_task",
    "sync_job",
    "local_seo_content",
    "content_generation",
    "store_change_proposal",
    "store_profile",
)

TEMPORARY_CLOSURE_RANGE_SQL: Final = """
(temporary_closure_start_date IS NULL AND temporary_closure_end_date IS NULL)
OR (
    temporary_closure_start_date IS NOT NULL
    AND temporary_closure_end_date IS NOT NULL
    AND temporary_closure_end_date >= temporary_closure_start_date
)
"""
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
ATTEMPT_COUNT_RANGE_SQL: Final = "attempt_count >= 0 AND attempt_count <= 3"


def _enum(name: str) -> postgresql.ENUM:
    """Reference an enum type this revision already created."""
    return postgresql.ENUM(*ENUM_VALUES[name], name=name, create_type=False)


def upgrade() -> None:
    """Apply this revision."""
    for name, values in ENUM_VALUES.items():
        rendered = ", ".join(f"'{value}'" for value in values)
        op.execute(f"CREATE TYPE {name} AS ENUM ({rendered})")

    op.create_table(
        "store_profile",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("store_name", sa.String(), nullable=False),
        sa.Column("public_address", sa.Text(), nullable=False),
        sa.Column("business_hours", postgresql.JSONB(), nullable=False),
        sa.Column("temporary_closure_start_date", sa.Date(), nullable=True),
        sa.Column("temporary_closure_end_date", sa.Date(), nullable=True),
        sa.Column("representative_menu_name", sa.String(length=50), nullable=False),
        sa.Column("representative_phone", sa.String(), nullable=False),
        sa.Column("platform_account_refs", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_store_profile"),
        sa.CheckConstraint(TEMPORARY_CLOSURE_RANGE_SQL, name="temporary_closure_range"),
    )

    op.create_table(
        "store_change_proposal",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("store_profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("recognized_text_masked", sa.String(length=500), nullable=False),
        sa.Column("changes", postgresql.JSONB(), nullable=False),
        sa.Column("status", _enum(PROPOSAL_STATUS), nullable=False),
        sa.Column("approved_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("rejected_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_store_change_proposal"),
        sa.ForeignKeyConstraint(
            ["store_profile_id"],
            ["store_profile.id"],
            name="fk_store_change_proposal_store_profile_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_store_change_proposal_store_profile_id",
        "store_change_proposal",
        ["store_profile_id"],
    )

    op.create_table(
        "content_generation",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("store_profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("brief_text", sa.String(length=500), nullable=False),
        sa.Column("seed_keywords", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column(
            "source_review_ids",
            postgresql.ARRAY(postgresql.UUID(as_uuid=True)),
            nullable=True,
        ),
        sa.Column("status", _enum(CONTENT_GENERATION_STATUS), nullable=False),
        sa.Column("revision", sa.Integer(), server_default=sa.text("1"), nullable=False),
        sa.Column("approved_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("rejected_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_content_generation"),
        sa.ForeignKeyConstraint(
            ["store_profile_id"],
            ["store_profile.id"],
            name="fk_content_generation_store_profile_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("revision >= 1", name="positive_revision"),
    )
    op.create_index(
        "ix_content_generation_store_profile_id",
        "content_generation",
        ["store_profile_id"],
    )

    op.create_table(
        "local_seo_content",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("content_generation_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform", _enum(PLATFORM), nullable=False),
        sa.Column("draft_text", sa.String(length=750), nullable=False),
        sa.Column("keywords", postgresql.ARRAY(sa.Text()), nullable=False),
        sa.Column("content_rules", postgresql.JSONB(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_local_seo_content"),
        sa.ForeignKeyConstraint(
            ["content_generation_id"],
            ["content_generation.id"],
            name="fk_local_seo_content_content_generation_id",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "content_generation_id",
            "platform",
            name="uq_local_seo_content_content_generation_id_platform",
        ),
    )
    op.create_index(
        "ix_local_seo_content_content_generation_id",
        "local_seo_content",
        ["content_generation_id"],
    )

    op.create_table(
        "sync_job",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("store_profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("source_type", _enum(SYNC_SOURCE_TYPE), nullable=False),
        sa.Column("store_change_proposal_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("content_generation_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("status", _enum(SYNC_JOB_STATUS), nullable=False),
        sa.Column("approved_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("approved_by", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=False),
        sa.Column("idempotency_request_hash", sa.CHAR(length=64), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_sync_job"),
        sa.ForeignKeyConstraint(
            ["store_profile_id"],
            ["store_profile.id"],
            name="fk_sync_job_store_profile_id",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["store_change_proposal_id"],
            ["store_change_proposal.id"],
            name="fk_sync_job_store_change_proposal_id",
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["content_generation_id"],
            ["content_generation.id"],
            name="fk_sync_job_content_generation_id",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(SOURCE_EXCLUSIVITY_SQL, name="source_exclusivity"),
        sa.UniqueConstraint(
            "approved_by",
            "idempotency_key",
            name="uq_sync_job_approved_by_idempotency_key",
        ),
    )
    op.create_index("ix_sync_job_store_profile_id", "sync_job", ["store_profile_id"])
    op.create_index(
        "ix_sync_job_store_change_proposal_id",
        "sync_job",
        ["store_change_proposal_id"],
    )
    op.create_index("ix_sync_job_content_generation_id", "sync_job", ["content_generation_id"])

    op.create_table(
        "platform_sync_task",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("sync_job_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("platform", _enum(PLATFORM), nullable=False),
        sa.Column("status", _enum(PLATFORM_SYNC_TASK_STATUS), nullable=False),
        sa.Column("attempt_count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("next_retry_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column("error_code", sa.Text(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("retryable", sa.Boolean(), nullable=True),
        sa.Column("last_attempt_at", postgresql.TIMESTAMP(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_platform_sync_task"),
        sa.ForeignKeyConstraint(
            ["sync_job_id"],
            ["sync_job.id"],
            name="fk_platform_sync_task_sync_job_id",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(ATTEMPT_COUNT_RANGE_SQL, name="attempt_count_range"),
        sa.UniqueConstraint(
            "sync_job_id",
            "platform",
            name="uq_platform_sync_task_sync_job_id_platform",
        ),
    )
    op.create_index("ix_platform_sync_task_sync_job_id", "platform_sync_task", ["sync_job_id"])


def downgrade() -> None:
    """Revert this revision."""
    for table in TABLES:
        op.drop_table(table)

    for name in ENUM_VALUES:
        op.execute(f"DROP TYPE {name}")
