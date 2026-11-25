from fastapi.testclient import TestClient
from unittest.mock import patch


def test_health_check_returns_http_200(client: TestClient):
    """
    Test that GET /health returns HTTP 200 and expected schema.
    """
    response = client.get("/health")
    assert response.status_code == 200

    data = response.json()
    assert data["status"] == "ok"
    assert "environment" in data
    assert "database" in data
    assert "version" in data
    assert "timestamp" in data


def test_api_v1_health_returns_http_200(client: TestClient):
    """
    Test that GET /api/v1/health also returns HTTP 200.
    """
    response = client.get("/api/v1/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"


def test_root_endpoint_metadata(client: TestClient):
    """
    Test that GET / returns 200 and application metadata.
    """
    response = client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "online"
    assert "name" in data
    assert "version" in data


def test_cors_headers_configured_for_frontend(client: TestClient):
    """
    Test that CORS headers allow localhost:3000 frontend access.
    """
    response = client.options(
        "/health",
        headers={
            "Origin": "http://localhost:3000",
            "Access-Control-Request-Method": "GET",
        },
    )
    # FastApi / Starlette CORSMiddleware responds with 200 on preflight
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "http://localhost:3000"


def test_health_check_db_connected(client: TestClient):
    """
    Test health check reporting when database is connected.
    """
    with patch("app.routes.health.check_db_health", return_value=(True, "connected")):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["database"] == "connected"


def test_health_check_db_disconnected(client: TestClient):
    """
    Test health check graceful reporting when database is temporarily disconnected.
    Endpoint must still return HTTP 200 so orchestrators know the API is responsive.
    """
    with patch("app.routes.health.check_db_health", return_value=(False, "disconnected: connection refused")):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "disconnected" in data["database"]
