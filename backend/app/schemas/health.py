from datetime import datetime
from pydantic import BaseModel, ConfigDict, Field


class HealthResponse(BaseModel):
    """Schema for health-check endpoint response."""
    status: str = Field(default="ok", description="Overall health status of the application")
    environment: str = Field(..., description="Application execution environment")
    database: str = Field(..., description="Database connection status")
    version: str = Field(..., description="Application version")
    timestamp: datetime = Field(default_factory=datetime.utcnow, description="UTC timestamp of the check")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "status": "ok",
                "environment": "development",
                "database": "connected",
                "version": "0.1.0",
                "timestamp": "2026-11-25T06:18:00Z"
            }
        }
    )
