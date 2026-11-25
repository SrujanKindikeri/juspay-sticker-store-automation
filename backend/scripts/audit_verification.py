"""
Phase 1.1 Foundation Audit Script
Validates Backend, PostgreSQL, SQLAlchemy, Environment Variables, HTTP Endpoints, and CORS.
"""
import os
import sys

# Ensure backend root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import text
from app.core.config import settings
from app.database.session import engine, SessionLocal, check_db_health
from app.database.base import Base
import app.models  # load models
import httpx


def audit_backend_and_database():
    results = {}

    # 1. Environment Variables
    results["env_loaded"] = {
        "app_name": settings.app_name,
        "environment": settings.environment,
        "debug": settings.debug,
        "backend_host": settings.backend_host,
        "backend_port": settings.backend_port,
        "postgres_host": settings.postgres_host,
        "postgres_port": settings.postgres_port,
        "postgres_db": settings.postgres_db,
        "postgres_user": settings.postgres_user,
        # Password intentionally masked for security
        "postgres_password_masked": "***" if settings.postgres_password else "NONE",
        "cors_origins": settings.cors_origins,
    }

    # 2. Database Dialect Check
    dialect_name = engine.dialect.name
    results["database_dialect"] = dialect_name
    results["is_postgresql"] = dialect_name == "postgresql"
    results["is_not_sqlite"] = dialect_name != "sqlite"

    # 3. SQLAlchemy Live Query Execution
    with engine.connect() as conn:
        # Execute real SELECT 1
        res = conn.execute(text("SELECT 1")).scalar()
        results["select_1_result"] = res

        # Query database metadata
        meta = conn.execute(
            text("SELECT current_database(), current_user, version();")
        ).fetchone()
        results["current_database"] = meta[0]
        results["current_user"] = meta[1]
        results["postgres_version"] = meta[2]

        # Check existing public tables
        tables_res = conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public';")
        ).fetchall()
        results["public_tables"] = [t[0] for t in tables_res]

    # 4. Session establishment and closure
    db_session = SessionLocal()
    try:
        session_active = db_session.is_active
        results["session_established"] = session_active
    finally:
        db_session.close()
        results["session_closed"] = True

    # 5. Live HTTP Endpoints via HTTPX
    with httpx.Client(base_url="http://localhost:8001", timeout=5.0) as client:
        # GET /health
        r_health = client.get("/health")
        results["health_endpoint"] = {
            "status_code": r_health.status_code,
            "json": r_health.json(),
        }

        # GET /docs
        r_docs = client.get("/docs")
        results["docs_endpoint"] = {
            "status_code": r_docs.status_code,
            "is_html": "text/html" in r_docs.headers.get("content-type", ""),
        }

        # CORS preflight from localhost:3001
        r_cors_preflight = client.options(
            "/health",
            headers={
                "Origin": "http://localhost:3001",
                "Access-Control-Request-Method": "GET",
            },
        )
        results["cors_preflight"] = {
            "status_code": r_cors_preflight.status_code,
            "allow_origin": r_cors_preflight.headers.get("access-control-allow-origin"),
            "allow_methods": r_cors_preflight.headers.get("access-control-allow-methods"),
        }

        # GET request with origin header
        r_cors_get = client.get(
            "/health",
            headers={"Origin": "http://localhost:3001"},
        )
        results["cors_get"] = {
            "status_code": r_cors_get.status_code,
            "allow_origin": r_cors_get.headers.get("access-control-allow-origin"),
        }

    return results


if __name__ == "__main__":
    import json
    data = audit_backend_and_database()
    print("AUDIT_JSON_OUTPUT_START")
    print(json.dumps(data, indent=2))
    print("AUDIT_JSON_OUTPUT_END")
