"""Export the OpenAPI document so the frontend consumes one committed contract.

Regenerate with ``uv run --locked python -m mapkeeper.openapi``.
"""

import json
from pathlib import Path
from typing import Final, cast

from mapkeeper.core.json_types import JsonObject
from mapkeeper.main import app

OPENAPI_FILENAME: Final = "openapi.json"


def build_openapi() -> JsonObject:
    """Return the OpenAPI document the running application serves."""
    return cast("JsonObject", app.openapi())


def render_openapi() -> str:
    """Return the document as the committed file's exact text."""
    return json.dumps(build_openapi(), indent=2, ensure_ascii=False, sort_keys=True) + "\n"


def default_output_path() -> Path:
    """Return the committed contract path at the backend project root."""
    return Path(__file__).resolve().parents[2] / OPENAPI_FILENAME


def main(path: Path | None = None) -> None:
    """Write the OpenAPI document, defaulting to the committed contract path."""
    target = path if path is not None else default_output_path()
    _ = target.write_text(render_openapi(), encoding="utf-8")


if __name__ == "__main__":
    main()
