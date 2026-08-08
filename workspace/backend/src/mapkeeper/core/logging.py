"""Request-scoped tracing and logging that cannot leak PII or secrets.

Every log line carries the request id, so a request, the SyncJob it created and each
PlatformSyncTask can be followed through one operator search. Values that must never
be written are reduced to a short fingerprint instead.
"""

import logging
import re
import sys
from contextvars import ContextVar, Token
from hashlib import sha256
from typing import Final
from uuid import UUID, uuid4

REQUEST_ID_HEADER: Final = "X-Request-ID"
REQUEST_ID_MAX_LENGTH: Final = 128
REQUEST_ID_PATTERN: Final = re.compile(r"^[A-Za-z0-9._:-]+$")
FINGERPRINT_LENGTH: Final = 12
UNSET_REQUEST_ID: Final = "-"
LOG_FORMAT: Final = "%(asctime)s %(levelname)s [%(request_id)s] %(name)s %(message)s"

_request_id: ContextVar[str] = ContextVar("mapkeeper_request_id", default=UNSET_REQUEST_ID)


def new_request_id() -> str:
    """Return a fresh trace id for a request that arrived without one."""
    return uuid4().hex


def sanitize_request_id(raw: str | None) -> str:
    """Accept a client trace id only when it is short and safe to echo and log."""
    if raw is None:
        return new_request_id()
    candidate = raw.strip()
    if not candidate or len(candidate) > REQUEST_ID_MAX_LENGTH:
        return new_request_id()
    if not REQUEST_ID_PATTERN.match(candidate):
        return new_request_id()
    return candidate


def set_request_id(value: str) -> Token[str]:
    """Bind the trace id for the current request and return its reset token."""
    return _request_id.set(value)


def reset_request_id(token: Token[str]) -> None:
    """Release the trace id bound for the current request."""
    _request_id.reset(token)


def get_request_id() -> str:
    """Return the trace id of the current request, or a placeholder outside one."""
    return _request_id.get()


def fingerprint(value: str) -> str:
    """Return a short, irreversible stand-in so a secret can be correlated but not read.

    Used for the Idempotency-Key, whose full value the contract forbids logging.
    """
    return sha256(value.encode("utf-8")).hexdigest()[:FINGERPRINT_LENGTH]


def stamp_request_id(record: logging.LogRecord) -> bool:
    """Attach the current trace id to a record so the format string can print it.

    Used as a logging filter, which is why it always keeps the record.
    """
    record.request_id = get_request_id()
    return True


def configure_logging(level: str = "INFO") -> None:
    """Install one stderr handler that stamps every record with the request id."""
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    handler.addFilter(stamp_request_id)

    root = logging.getLogger()
    for existing in list(root.handlers):
        root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(level.upper())


def get_logger(name: str) -> logging.Logger:
    """Return a logger whose records carry the current request id."""
    logger = logging.getLogger(name)
    if stamp_request_id not in logger.filters:
        logger.addFilter(stamp_request_id)
    return logger


def job_context(sync_job_id: UUID, platform: str | None = None) -> str:
    """Return a log suffix linking a line to a SyncJob and optionally one platform."""
    if platform is None:
        return f"syncJobId={sync_job_id}"
    return f"syncJobId={sync_job_id} platform={platform}"
