"""Add SourceReview.

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-08

Stores the masked customer reviews a UC2 generation may optionally reference.
Only masked text is kept; raw customer PII never reaches this table.

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002"
down_revision: str | None = "0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Apply this revision."""
    op.create_table(
        "source_review",
        sa.Column("id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("store_profile_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("body_masked", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            postgresql.TIMESTAMP(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_source_review"),
        sa.ForeignKeyConstraint(
            ["store_profile_id"],
            ["store_profile.id"],
            name="fk_source_review_store_profile_id",
            ondelete="CASCADE",
        ),
    )
    op.create_index(
        "ix_source_review_store_profile_id",
        "source_review",
        ["store_profile_id"],
    )


def downgrade() -> None:
    """Revert this revision."""
    op.drop_table("source_review")
