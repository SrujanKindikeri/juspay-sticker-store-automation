from sqlalchemy import text
from app.database.session import engine, SessionLocal
from app.core.config import settings
from fastapi.testclient import TestClient


def test_database_dialect_is_postgresql():
    """Verify that the application is configured with PostgreSQL, not SQLite."""
    assert engine.dialect.name == "postgresql"
    assert engine.dialect.name != "sqlite"


def test_real_select_1_against_database():
    """Execute a real SELECT 1 query against PostgreSQL."""
    with engine.connect() as conn:
        result = conn.execute(text("SELECT 1")).scalar()
        assert result == 1


def test_database_session_lifecycle():
    """Verify that SQLAlchemy can establish and close a database session cleanly."""
    session = SessionLocal()
    try:
        assert session.is_active is True
        res = session.execute(text("SELECT current_database();")).scalar()
        assert res == settings.postgres_db
    finally:
        session.close()


def test_docs_endpoint(client: TestClient):
    """Verify that GET /docs (Swagger UI) returns HTTP 200."""
    response = client.get("/docs")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]


def test_redoc_endpoint(client: TestClient):
    """Verify that GET /redoc returns HTTP 200."""
    response = client.get("/redoc")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
