"""Request-scoped tracing installed in front of every route."""

from collections.abc import Awaitable, Callable

from fastapi import Request, Response

from mapkeeper.core.logging import (
    REQUEST_ID_HEADER,
    reset_request_id,
    sanitize_request_id,
    set_request_id,
)

CallNext = Callable[[Request], Awaitable[Response]]


async def request_id_middleware(request: Request, call_next: CallNext) -> Response:
    """Bind a trace id for the request and return it on the response.

    A client id is reused only when it is short and safe to echo; anything else is
    replaced with a generated one rather than reflected back.
    """
    request_id = sanitize_request_id(request.headers.get(REQUEST_ID_HEADER))
    token = set_request_id(request_id)
    try:
        response = await call_next(request)
    finally:
        reset_request_id(token)
    response.headers[REQUEST_ID_HEADER] = request_id
    return response
