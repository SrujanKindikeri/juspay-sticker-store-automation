from datetime import datetime
from sqlalchemy import Column, Integer, String, Float, DateTime
from app.database.base import Base


class PaymentTransaction(Base):
    """
    Simulated Payment Transaction Model.
    Supports complete payment lifecycle: PENDING -> OTP_SENT -> SUCCESS / FAILED.
    
    Security:
    - Card numbers, CVV, passwords, and sensitive financial credentials
      are NEVER stored.
    - OTP is stored only as a secure cryptographic hash (SHA-256 + salt).
    """
    __tablename__ = "payment_transactions"

    id = Column(Integer, primary_key=True, index=True)
    transaction_id = Column(String(64), unique=True, index=True, nullable=False)
    payment_reference = Column(String(64), unique=True, index=True, nullable=False)
    order_id = Column(String(64), index=True, nullable=False)
    amount = Column(Float, nullable=False)
    currency = Column(String(10), default="INR", nullable=False)
    status = Column(String(30), default="PENDING", index=True, nullable=False)  # PENDING, AUTHENTICATED, PROCESSING, SUCCESS, DECLINED, FAILED
    payment_method = Column(String(30), nullable=False)  # CARD, UPI, NET_BANKING
    customer_email = Column(String(120), nullable=True)

    # Secure OTP verification fields
    otp_hash = Column(String(128), nullable=True)
    otp_expires_at = Column(DateTime, nullable=True)
    otp_attempts = Column(Integer, default=0, nullable=False)
    resend_count = Column(Integer, default=0, nullable=False)
    last_otp_sent_at = Column(DateTime, nullable=True)

    # Idempotency key for duplicate payment prevention
    idempotency_key = Column(String(128), index=True, nullable=True)

    # Lifecycle timestamps
    created_at = Column(DateTime, default=datetime.utcnow, index=True, nullable=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    finalized_at = Column(DateTime, nullable=True)

    @property
    def is_finalized(self) -> bool:
        """Indicates if the transaction is in a terminal state."""
        return self.status in ("SUCCESS", "DECLINED", "FAILED")

    def __repr__(self) -> str:
        return (
            f"<PaymentTransaction {self.transaction_id} "
            f"(Ref: {self.payment_reference}): {self.amount} {self.currency} - {self.status}>"
        )
