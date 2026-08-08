"""JSON-shaped type aliases used by JSONB columns and by the OpenAPI document."""

from typing import TypeAlias

JsonValue: TypeAlias = "str | int | float | bool | list[JsonValue] | dict[str, JsonValue] | None"
JsonObject: TypeAlias = "dict[str, JsonValue]"

__all__ = ["JsonObject", "JsonValue"]
