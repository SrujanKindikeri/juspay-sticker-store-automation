from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime
from app.database.base import Base


class EmailVerificationSession(Base):
    """
    Stores email OTP verification sessions independently from payment OTPs.
    Never stores plaintext OTPs or verification tokens; stores keyed HMAC-SHA256 hashes only.
    """
    __tablename__ = "email_verification_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(64), unique=True, index=True, nullable=False)
    email = Column(String(120), index=True, nullable=False)
    status = Column(String(30), default="PENDING", index=True, nullable=False)  # PENDING, VERIFIED, FAILED, EXPIRED

    # Keyed HMAC-SHA256 hashes only (never plaintext OTPs or tokens)
    otp_hash = Column(String(128), nullable=True)
    otp_expires_at = Column(DateTime, nullable=True)
    otp_attempts = Column(Integer, default=0, nullable=False)
    resend_count = Column(Integer, default=0, nullable=False)
    last_otp_sent_at = Column(DateTime, nullable=True)

    verified_at = Column(DateTime, nullable=True)
    verification_token_hash = Column(String(128), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<EmailVerificationSession {self.session_id}: {self.status}>"
