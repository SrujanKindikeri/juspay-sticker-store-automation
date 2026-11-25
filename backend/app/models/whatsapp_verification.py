from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime
from app.database.base import Base


class WhatsAppVerificationSession(Base):
    """
    Stores WhatsApp OTP verification state for customer checkout mobile verification.
    Stores only keyed HMAC-SHA256 hashes of OTPs and verification tokens, never plaintext OTPs.
    """

    __tablename__ = "whatsapp_verification_sessions"

    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String(64), unique=True, index=True, nullable=False)
    phone_e164 = Column(String(24), index=True, nullable=False)
    phone_masked = Column(String(32), nullable=False)
    client_ip = Column(String(64), index=True, nullable=True)

    otp_hash = Column(String(128), nullable=True)
    otp_expires_at = Column(DateTime, nullable=True)
    otp_attempts = Column(Integer, default=0, nullable=False)
    resend_count = Column(Integer, default=0, nullable=False)
    last_otp_sent_at = Column(DateTime, nullable=True)

    status = Column(String(20), default="PENDING", index=True, nullable=False)
    verified_at = Column(DateTime, nullable=True)
    verification_token_hash = Column(String(128), nullable=True)
    order_id = Column(String(64), index=True, nullable=True)

    provider = Column(String(32), default="berryprotocol", nullable=False)
    provider_message_id = Column(String(128), nullable=True)
    delivery_ack_status = Column(String(32), nullable=True)

    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

    def __repr__(self) -> str:
        return f"<WhatsAppVerificationSession {self.session_id} phone={self.phone_masked} status={self.status}>"
