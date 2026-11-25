from typing import List, Optional
import os
from pydantic import computed_field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application configuration settings loaded from environment variables."""

    # Application
    app_name: str = "JUSPAY Payment Gateway Simulator"
    app_version: str = "0.1.0"
    environment: str = "development"
    debug: bool = True

    # Server
    backend_host: str = "0.0.0.0"
    backend_port: int = 8001

    # Database
    postgres_user: str = "postgres"
    postgres_password: str = "postgres"
    postgres_host: str = "localhost"
    postgres_port: int = 5433
    postgres_db: str = "juspay_db"
    database_url: Optional[str] = None

    # CORS
    allowed_origins: str = (
        "http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000,http://127.0.0.1:3001"
    )

    # OTP Security & Cryptography
    otp_secret_key: str = "juspay_sec_hmac_key_2026_audit_challenge_key"
    otp_resend_cooldown_seconds: int = 30
    otp_expiry_minutes: int = 5
    otp_max_attempts: int = 3
    otp_max_resends: int = 3

    model_config = SettingsConfigDict(
        env_file=(".env", "../.env", "../../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    @property
    def is_development(self) -> bool:
        """Returns True if the application is running in development/testing mode."""
        return self.environment.lower() in ("development", "dev", "test", "testing")

    @property
    def is_production(self) -> bool:
        """Returns True if the application is running in production mode."""
        return not self.is_development

    @computed_field
    def computed_database_url(self) -> str:
        """Returns the configured or default PostgreSQL database URL."""
        if self.database_url:
            return self.database_url
        return (
            f"postgresql://{self.postgres_user}:{self.postgres_password}@"
            f"{self.postgres_host}:{self.postgres_port}/{self.postgres_db}"
        )

    @property
    def cors_origins(self) -> List[str]:
        """Parses allowed_origins into a list of strings."""
        if isinstance(self.allowed_origins, list):
            return self.allowed_origins
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


settings = Settings()
