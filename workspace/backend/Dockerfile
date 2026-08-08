FROM python:3.11-slim-trixie

COPY --from=ghcr.io/astral-sh/uv:0.11.32 /uv /uvx /bin/

ENV PATH="/app/.venv/bin:$PATH" \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_NO_CACHE=1

WORKDIR /app

COPY pyproject.toml uv.lock README.md ./
RUN uv sync --locked --no-dev --no-install-project

COPY src ./src
RUN uv sync --locked --no-dev --no-editable

# Migrations ship with the code that expects the schema they create, so the
# deployment runs `alembic upgrade head` from this image rather than from a
# checkout that could be a different commit. Copied after the dependency sync so
# editing a migration does not rebuild the virtual environment.
COPY alembic.ini ./
COPY alembic ./alembic

RUN useradd --no-create-home --uid 10001 mapkeeper
USER mapkeeper

EXPOSE 8000

CMD ["uvicorn", "mapkeeper.main:app", "--host", "0.0.0.0", "--port", "8000"]

