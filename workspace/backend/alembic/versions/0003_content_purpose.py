"""Add the UC2 content purpose discriminator."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003"
down_revision: str | None = "0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add purpose with the introduction behavior as the legacy default."""
    purpose = postgresql.ENUM("INTRODUCTION", "NEWS", name="content_purpose")
    purpose.create(op.get_bind(), checkfirst=True)
    op.add_column(
        "content_generation",
        sa.Column("purpose", purpose, nullable=False, server_default="INTRODUCTION"),
    )


def downgrade() -> None:
    """Remove the content purpose discriminator."""
    op.drop_column("content_generation", "purpose")
    postgresql.ENUM(name="content_purpose").drop(op.get_bind(), checkfirst=True)
