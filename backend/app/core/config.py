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

    # Email Verification & SMTP Delivery
    email_verification_enabled: bool = True
    smtp_host: str = "localhost"
    smtp_port: int = 1025
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_email: str = "no-reply@stickora.demo"
    smtp_from_name: str = "Stickora Store"
    smtp_use_tls: bool = False
    smtp_use_ssl: bool = False
    email_max_retries: int = 3

    # Experimental WhatsApp Integration (BerryProtocol)
    whatsapp_provider: str = "berryprotocol"
    whatsapp_enabled: bool = True
    whatsapp_experimental: bool = True
    whatsapp_sender_name: str = "Stickora Store"
    whatsapp_session_id: str = "stickora_berry_session"
    whatsapp_session_path: str = "./data/berry_auth"
    whatsapp_database_path: str = "./data/berry_store.db"
    whatsapp_meta_file: str = "./data/whatsapp_session.json"
    whatsapp_service_url: str = "http://127.0.0.1:8002"
    whatsapp_internal_api_key: str = ""
    whatsapp_admin_key: str = ""
    whatsapp_dispatch_enabled: bool = True
    whatsapp_request_timeout_seconds: float = 10.0
    whatsapp_rate_limit_window_seconds: int = 600
    whatsapp_rate_limit_max_requests: int = 6

    # Payment Provider Configuration ("simulated" or "paytm")
    payment_provider: str = "simulated"

    # Paytm Payment Gateway Sandbox Configuration
    paytm_mid: str = ""
    paytm_merchant_key: str = ""
    paytm_website: str = "WEBSTAGING"
    paytm_channel_id: str = "WEB"
    paytm_industry_type_id: str = "Retail"
    paytm_callback_url: str = "http://localhost:8001/api/v1/payments/paytm/callback"
    paytm_environment: str = "staging"  # "staging" or "production"
    paytm_timeout_seconds: float = 15.0

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

    @property
    def paytm_base_url(self) -> str:
        """Returns the official base gateway URL according to the configured environment."""
        if self.paytm_environment.lower() == "production":
            return "https://securegw.paytm.in"
        return "https://securegw-stage.paytm.in"

    @property
    def is_paytm_configured(self) -> bool:
        """Returns True if minimum required Paytm merchant credentials are provided."""
        return bool(self.paytm_mid.strip() and self.paytm_merchant_key.strip())


settings = Settings()
