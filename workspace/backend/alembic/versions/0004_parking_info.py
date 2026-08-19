"""Add the store profile parking info column."""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004"
down_revision: str | None = "0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Add the nullable parking info column to store_profile."""
    op.add_column(
        "store_profile",
        sa.Column("parking_info", sa.String(length=50), nullable=True),
    )


def downgrade() -> None:
    """Remove the parking info column."""
    op.drop_column("store_profile", "parking_info")
