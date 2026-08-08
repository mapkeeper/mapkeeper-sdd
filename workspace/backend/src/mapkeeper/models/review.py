from sqlalchemy import ForeignKey, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from mapkeeper.models.base import Base, TimestampTz, UuidPk, UuidValue


class SourceReview(Base):
    """Masked customer review a generation may optionally take inspiration from.

    Only masked text is stored. Raw customer PII never reaches this table and is
    never forwarded to Gemini.
    """

    __tablename__: str = "source_review"

    id: Mapped[UuidPk] = mapped_column()
    store_profile_id: Mapped[UuidValue] = mapped_column(
        ForeignKey("store_profile.id", ondelete="CASCADE"),
        index=True,
    )
    body_masked: Mapped[str] = mapped_column(Text())
    created_at: Mapped[TimestampTz] = mapped_column(server_default=func.now())
