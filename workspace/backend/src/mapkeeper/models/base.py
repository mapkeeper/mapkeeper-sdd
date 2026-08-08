from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING, Annotated, ClassVar, Final, TypeAlias, TypeVar
from uuid import UUID, uuid4

from sqlalchemy import Enum, MetaData, func
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

if TYPE_CHECKING:
    from sqlalchemy.sql.schema import SchemaItem

EnumT = TypeVar("EnumT", bound=StrEnum)

JsonValue: TypeAlias = "str | int | float | bool | list[JsonValue] | dict[str, JsonValue] | None"
JsonObject: TypeAlias = "dict[str, JsonValue]"
TableArgs: TypeAlias = "tuple[SchemaItem, ...]"

NAMING_CONVENTION: Final[dict[str, str]] = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_N_name)s",
    "pk": "pk_%(table_name)s",
}

UuidPk = Annotated[
    UUID,
    mapped_column(postgresql.UUID(as_uuid=True), primary_key=True, default=uuid4),
]
UuidValue = Annotated[UUID, mapped_column(postgresql.UUID(as_uuid=True))]
TimestampTz = Annotated[datetime, mapped_column(postgresql.TIMESTAMP(timezone=True))]


def _enum_values(enum_type: type[EnumT]) -> list[str]:
    return [member.value for member in enum_type]


def pg_enum(enum_type: type[EnumT], name: str) -> Enum:
    """Map a Python ``StrEnum`` to a native PostgreSQL enum storing its string values."""
    return Enum(enum_type, name=name, values_callable=_enum_values)


class Base(DeclarativeBase):
    """Declarative base carrying the shared metadata and constraint naming convention."""

    metadata: ClassVar[MetaData] = MetaData(naming_convention=NAMING_CONVENTION)


class TimestampMixin:
    """Server-managed creation and modification timestamps."""

    created_at: Mapped[TimestampTz] = mapped_column(server_default=func.now())
    updated_at: Mapped[TimestampTz] = mapped_column(
        server_default=func.now(),
        onupdate=func.now(),
    )
