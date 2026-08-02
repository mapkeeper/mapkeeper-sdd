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
