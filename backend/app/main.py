from contextlib import asynccontextmanager
import logging
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.database.session import engine, check_db_health
from app.database.base import Base
import app.models  # ensure models are registered
from app.routes.health import router as health_router
from app.routes import api_router

# Setup logger
logging.basicConfig(
    level=logging.INFO if not settings.debug else logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("juspay.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan manager: runs startup and shutdown logic."""
    logger.info(f"Starting {settings.app_name} v{settings.app_version} [{settings.environment}]")
    try:
        from sqlalchemy import text
        Base.metadata.create_all(bind=engine)
        # Ensure payment_reference and OTP columns exist on existing tables
        with engine.connect() as conn:
            conn.execute(text("""
                ALTER TABLE payment_transactions 
                ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(64);
            """))
            conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS ix_payment_transactions_payment_reference 
                ON payment_transactions (payment_reference);
            """))
            conn.execute(text("""
                ALTER TABLE payment_transactions 
                ADD COLUMN IF NOT EXISTS otp_hash VARCHAR(128);
            """))
            conn.execute(text("""
                ALTER TABLE payment_transactions 
                ADD COLUMN IF NOT EXISTS otp_expires_at TIMESTAMP;
            """))
            conn.execute(text("""
                ALTER TABLE payment_transactions 
                ADD COLUMN IF NOT EXISTS otp_attempts INTEGER DEFAULT 0;
            """))
            conn.execute(text("""
                ALTER TABLE payment_transactions 
                ADD COLUMN IF NOT EXISTS resend_count INTEGER DEFAULT 0;
            """))
            conn.execute(text("""
                ALTER TABLE payment_transactions 
                ADD COLUMN IF NOT EXISTS last_otp_sent_at TIMESTAMP;
            """))
            conn.execute(text("""
                ALTER TABLE payment_transactions 
                ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_payment_transactions_idempotency_key 
                ON payment_transactions (idempotency_key);
            """))
            conn.execute(text("""
                ALTER TABLE payment_transactions 
                ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMP;
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_payment_transactions_status 
                ON payment_transactions (status);
            """))
            conn.execute(text("""
                CREATE INDEX IF NOT EXISTS ix_payment_transactions_created_at 
                ON payment_transactions (created_at);
            """))
            # Backfill finalized_at for existing terminal transactions
            conn.execute(text("""
                UPDATE payment_transactions 
                SET finalized_at = updated_at 
                WHERE status IN ('SUCCESS', 'DECLINED', 'FAILED') AND finalized_at IS NULL;
            """))
            # Data sanitation: Ensure finalized transactions never retain OTP hashes
            conn.execute(text("""
                UPDATE payment_transactions 
                SET otp_hash = NULL 
                WHERE status IN ('SUCCESS', 'DECLINED', 'FAILED') AND otp_hash IS NOT NULL;
            """))
            # Phase 8 schema migration for store_orders
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS order_token_hash VARCHAR(128);
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS stock_reserved BOOLEAN DEFAULT TRUE;
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS payment_transaction_id VARCHAR(64);
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS payment_reference VARCHAR(64);
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMP;
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS email_verification_session_id VARCHAR(64);
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS receipt_email_status VARCHAR(30) DEFAULT 'NOT_SENT';
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS receipt_email_sent_at TIMESTAMP;
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS receipt_email_attempts INTEGER DEFAULT 0;
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS receipt_email_last_error VARCHAR(255);
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS receipt_email_last_attempt_at TIMESTAMP;
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS contact_verification_channel VARCHAR(20) DEFAULT 'email';
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS whatsapp_verified BOOLEAN DEFAULT FALSE;
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS whatsapp_verified_at TIMESTAMP;
            """))
            conn.execute(text("""
                ALTER TABLE store_orders 
                ADD COLUMN IF NOT EXISTS whatsapp_verification_session_id VARCHAR(64);
            """))
            conn.commit()
        # Seed physical sticker store catalog if empty
        from app.services.store_service import seed_store_catalog
        from app.database.session import SessionLocal
        with SessionLocal() as seed_db:
            seed_store_catalog(seed_db)
        logger.info("Database tables and sticker store catalogue verified and initialized successfully.")
    except Exception as e:
        logger.warning(f"Database table initialization warning: {e}")
    db_ok, db_status = check_db_health()
    logger.info(f"Initial Database connection status: {db_status}")
    yield
    logger.info("Shutting down application...")


# FastAPI application instance
app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="Simulated Payment Gateway Backend for JUSPAY Payment Automation Challenge.",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# CORS Configuration for local frontend development
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount /health directly at root for GET /health requirement
app.include_router(health_router)

# Mount API v1 router prefix
app.include_router(api_router, prefix="/api/v1")


@app.get("/", tags=["Root"])
def root():
    """Root landing endpoint providing system metadata."""
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "environment": settings.environment,
        "status": "online",
        "docs": "/docs",
        "health": "/health",
    }
