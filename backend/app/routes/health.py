from fastapi import APIRouter
from app.core.config import settings
from app.database.session import check_db_health
from app.schemas.health import HealthResponse

router = APIRouter(tags=["Health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    summary="Application Health Check",
    description="Returns the operational status of the FastAPI backend and database connectivity.",
)
def get_health() -> HealthResponse:
    """
    Health check endpoint:
    Returns HTTP 200 with status 'ok' and reports database connectivity.
    """
    db_healthy, db_status = check_db_health()
    return HealthResponse(
        status="ok",
        environment=settings.environment,
        database=db_status,
        version=settings.app_version,
    )
