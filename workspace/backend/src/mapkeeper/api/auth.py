# pyright: reportMissingTypeStubs=false, reportUnknownVariableType=false, reportUnknownMemberType=false
"""Firebase Authentication boundary for the HTTP API."""

from functools import lru_cache
from typing import Annotated, ClassVar, Final
from uuid import UUID, uuid5

from fastapi import Depends
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from firebase_admin import App, credentials, exceptions, get_app, initialize_app
from firebase_admin import auth as firebase_auth
from google.auth.exceptions import DefaultCredentialsError
from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError

from mapkeeper.core.config import get_settings
from mapkeeper.core.errors import AuthenticationError

FIREBASE_ACTOR_NAMESPACE: Final[UUID] = UUID("9c1d6f6d-8b5c-4d79-9d99-3a9a6f2cf9b1")
AUTH_REQUIRED_MESSAGE: Final[str] = "로그인이 필요합니다."
AUTH_VERIFY_MESSAGE: Final[str] = "로그인 정보를 확인하지 못했습니다."
bearer_scheme = HTTPBearer(auto_error=False)


class FirebaseClaims(BaseModel):
    """Minimal verified Firebase claims needed by MapKeeper."""

    model_config: ClassVar[ConfigDict] = ConfigDict(extra="ignore", frozen=True)

    uid: str


def firebase_uid_to_actor_id(uid: str) -> UUID:
    """Map a verified Firebase UID to the stable UUID used by existing approvals."""
    return uuid5(FIREBASE_ACTOR_NAMESPACE, uid)


@lru_cache(maxsize=1)
def _firebase_app() -> App:
    settings = get_settings()
    try:
        return get_app()
    except ValueError:
        pass

    credential = (
        credentials.Certificate(settings.firebase_credentials_path)
        if settings.firebase_credentials_path
        else credentials.ApplicationDefault()
    )
    options = {"projectId": settings.firebase_project_id} if settings.firebase_project_id else None
    return initialize_app(credential, options)


def _verify_token(token: str) -> FirebaseClaims:
    try:
        decoded = firebase_auth.verify_id_token(token, app=_firebase_app())
        return TypeAdapter(FirebaseClaims).validate_python(decoded)
    except (
        exceptions.FirebaseError,
        DefaultCredentialsError,
        FileNotFoundError,
        ValidationError,
    ) as error:
        raise AuthenticationError(AUTH_VERIFY_MESSAGE) from error


def get_current_actor(
    credentials_header: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer_scheme)],
) -> UUID:
    """Return the authenticated actor, with the legacy actor only in local mode."""
    settings = get_settings()
    if not settings.firebase_auth_required:
        return settings.mvp_actor_id
    if credentials_header is None:
        raise AuthenticationError(AUTH_REQUIRED_MESSAGE)
    claims = _verify_token(credentials_header.credentials)
    return firebase_uid_to_actor_id(claims.uid)


CurrentActor = Annotated[UUID, Depends(get_current_actor)]

__all__ = ["CurrentActor", "firebase_uid_to_actor_id", "get_current_actor"]
