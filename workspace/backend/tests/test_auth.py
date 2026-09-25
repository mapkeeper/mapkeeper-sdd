from uuid import UUID

import pytest
from fastapi.security import HTTPAuthorizationCredentials
from fastapi.testclient import TestClient

from mapkeeper.api import auth
from mapkeeper.core.config import get_settings
from mapkeeper.core.errors import AuthenticationError
from mapkeeper.main import app


def test_firebase_uid_maps_to_a_stable_actor_uuid() -> None:
    first = auth.firebase_uid_to_actor_id("firebase-user-1")
    second = auth.firebase_uid_to_actor_id("firebase-user-1")
    other = auth.firebase_uid_to_actor_id("firebase-user-2")

    assert isinstance(first, UUID)
    assert first == second
    assert first != other


def test_local_mode_keeps_the_mvp_actor() -> None:
    settings = get_settings()

    assert auth.get_current_actor(None) == settings.mvp_actor_id


def test_required_mode_rejects_a_missing_bearer_token(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FIREBASE_AUTH_REQUIRED", "true")
    get_settings.cache_clear()

    with pytest.raises(AuthenticationError):
        _ = auth.get_current_actor(None)


def test_required_mode_uses_the_verified_uid(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FIREBASE_AUTH_REQUIRED", "true")
    get_settings.cache_clear()

    def verified_token(token: str) -> auth.FirebaseClaims:
        return auth.FirebaseClaims(uid=token)

    monkeypatch.setattr(auth, "_verify_token", verified_token)
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="firebase-user-1")

    assert auth.get_current_actor(credentials) == auth.firebase_uid_to_actor_id("firebase-user-1")


def test_malformed_verified_claims_are_authentication_errors(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_app() -> object:
        return object()

    def fake_verify(_token: str, *, app: object) -> dict[str, object]:
        _ = app
        return {}

    monkeypatch.setattr("mapkeeper.api.auth._firebase_app", fake_app)
    monkeypatch.setattr("firebase_admin.auth.verify_id_token", fake_verify)
    monkeypatch.setenv("FIREBASE_AUTH_REQUIRED", "true")
    get_settings.cache_clear()
    credentials = HTTPAuthorizationCredentials(scheme="Bearer", credentials="malformed-claims")

    with pytest.raises(AuthenticationError):
        _ = auth.get_current_actor(credentials)


def test_required_mode_rejects_missing_tokens_at_the_http_boundary(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("FIREBASE_AUTH_REQUIRED", "true")
    get_settings.cache_clear()

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/v1/sync-jobs/66666666-6666-4666-8666-666666666666")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTHENTICATION_REQUIRED"
