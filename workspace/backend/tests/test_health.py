import pytest
from fastapi.testclient import TestClient

from mapkeeper.main import app


def test_health_returns_ok_when_service_is_running() -> None:
    # Given: a running MapKeeper API application.
    with TestClient(app) as client:
        # When: the health endpoint is requested.
        response = client.get("/health")

    # Then: the service reports a healthy response.
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_health_does_not_require_a_configured_database(monkeypatch: pytest.MonkeyPatch) -> None:
    # Given: a deployment that has not been given a DATABASE_URL yet.
    monkeypatch.delenv("DATABASE_URL", raising=False)

    # When: the service starts, serves health and shuts down.
    with TestClient(app) as client:
        response = client.get("/health")

    # Then: the database layer stays lazy so health checks keep passing.
    assert response.status_code == 200
