"""Narrow untyped JSON into the project's JsonValue aliases so checks stay type-safe."""

import json
from typing import cast

from mapkeeper.core.json_types import JsonObject, JsonValue


def parse(raw: str) -> JsonValue:
    """Parse a response body without letting an untyped value escape."""
    return cast("JsonValue", json.loads(raw))


def obj(value: JsonValue) -> JsonObject:
    """Narrow a JSON value to an object."""
    assert isinstance(value, dict), f"expected an object, got {type(value).__name__}"
    return value


def arr(value: JsonValue) -> list[JsonValue]:
    """Narrow a JSON value to an array."""
    assert isinstance(value, list), f"expected an array, got {type(value).__name__}"
    return value


def text_of(value: JsonValue) -> str:
    """Narrow a JSON value to a string."""
    assert isinstance(value, str), f"expected a string, got {type(value).__name__}"
    return value


def number_of(value: JsonValue) -> float:
    """Narrow a JSON value to a number. JSON Schema bounds may be rendered as floats."""
    assert not isinstance(value, bool), "expected a number, got bool"
    assert isinstance(value, int | float), f"expected a number, got {type(value).__name__}"
    return value


def strings_of(value: JsonValue) -> list[str]:
    """Narrow a JSON value to an array of strings."""
    return [text_of(item) for item in arr(value)]


def body_of(raw: str) -> JsonObject:
    """Parse a response body and narrow it to a JSON object."""
    return obj(parse(raw))
