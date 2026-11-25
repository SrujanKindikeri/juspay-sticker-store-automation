import secrets
import hashlib
import hmac
from datetime import datetime, timedelta
from typing import Tuple, Optional, Dict, Any
from sqlalchemy.orm import Session
from fastapi import HTTPException, status
from app.models.payment import PaymentTransaction
from app.core.config import settings
from app.core.clock import get_current_time
from app.services.payment_service import validate_state_transition
from app.services.store_service import sync_store_order_payment_status


def compute_otp_hmac(transaction_id: str, otp: str) -> str:
    """
    Computes a keyed HMAC-SHA256 using the server environment secret key.
    Binds transaction_id and OTP into the message to prevent cross-transaction replay.
    Protects against offline rainbow-table and dictionary attacks even if the database is leaked.
    """
    secret_key = settings.otp_secret_key.encode("utf-8")
    message = f"{transaction_id}:{otp}".encode("utf-8")
    return hmac.new(secret_key, message, hashlib.sha256).hexdigest()


def verify_otp_hmac(transaction_id: str, submitted_otp: str, stored_hash: str) -> bool:
    """
    Performs constant-time HMAC comparison to prevent timing side-channel attacks.
    """
    if not stored_hash or not submitted_otp:
        return False
    expected_hash = compute_otp_hmac(transaction_id, submitted_otp)
    return hmac.compare_digest(expected_hash, stored_hash)


def generate_six_digit_otp() -> str:
    """Generates a cryptographically secure 6-digit random OTP (100000 - 999999)."""
    return str(secrets.randbelow(900000) + 100000)


def send_otp_for_transaction(
    db: Session,
    transaction_id: str,
) -> Tuple[str, PaymentTransaction]:
    """
    Generates and associates a secure keyed HMAC OTP with a pending transaction.
    Returns (plaintext_otp, transaction).
    """
    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.transaction_id == transaction_id)
        .first()
    )
    if not txn:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction '{transaction_id}' not found",
        )

    if txn.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot issue OTP for transaction with status '{txn.status}'. Expected PENDING.",
        )

    otp = generate_six_digit_otp()
    now = datetime.utcnow()
    txn.otp_hash = compute_otp_hmac(txn.transaction_id, otp)
    txn.otp_expires_at = now + timedelta(minutes=settings.otp_expiry_minutes)
    txn.otp_attempts = 0
    txn.last_otp_sent_at = now

    db.commit()
    db.refresh(txn)

    return otp, txn


def verify_transaction_otp(
    db: Session,
    transaction_id: str,
    submitted_otp: str,
    clock_offset_seconds: float = 0.0,
) -> PaymentTransaction:
    """
    Verifies submitted OTP against the stored cryptographic HMAC-SHA256 hash.
    
    Payment Lifecycle Rule:
    - On success: marks transaction status = AUTHENTICATED (does NOT independently complete payment).
    - Invalidates OTP hash immediately to prevent reuse.
    - On failure: increments attempts; upon reaching max attempts, marks status = FAILED.
    - Supports controllable clock offsets in development/test environments for deterministic expiry audits.
    """
    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.transaction_id == transaction_id)
        .first()
    )
    if not txn:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction '{transaction_id}' not found",
        )

    if txn.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Transaction is already in '{txn.status}' state and cannot be verified.",
        )

    if not txn.otp_hash or not txn.otp_expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No active unverified OTP found for this transaction. Please request an OTP first.",
        )

    # Check if expired using controllable clock
    now = get_current_time(clock_offset_seconds)
    if now > txn.otp_expires_at:
        validate_state_transition(txn.status, "FAILED")
        txn.status = "FAILED"
        txn.otp_hash = None
        current_utc = datetime.utcnow()
        txn.finalized_at = current_utc
        txn.updated_at = current_utc
        sync_store_order_payment_status(
            db=db,
            order_id=txn.order_id,
            payment_status="FAILED",
            payment_transaction_id=txn.transaction_id,
            payment_reference=txn.payment_reference,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP has expired. Transaction marked as FAILED.",
        )

    # Check max attempts prior to verification
    if txn.otp_attempts >= settings.otp_max_attempts:
        validate_state_transition(txn.status, "FAILED")
        txn.status = "FAILED"
        txn.otp_hash = None
        current_utc = datetime.utcnow()
        txn.finalized_at = current_utc
        txn.updated_at = current_utc
        sync_store_order_payment_status(
            db=db,
            order_id=txn.order_id,
            payment_status="FAILED",
            payment_transaction_id=txn.transaction_id,
            payment_reference=txn.payment_reference,
        )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Maximum verification attempts ({settings.otp_max_attempts}) exceeded. Transaction marked as FAILED.",
        )

    # Constant-time HMAC comparison
    if verify_otp_hmac(txn.transaction_id, submitted_otp, txn.otp_hash):
        # Verification successful -> Set AUTHENTICATED (NOT SUCCESS)
        validate_state_transition(txn.status, "AUTHENTICATED")
        txn.status = "AUTHENTICATED"
        txn.otp_hash = None  # Invalidate OTP to prevent replay/reuse
        txn.otp_attempts = 0
        txn.updated_at = datetime.utcnow()
        db.commit()
        db.refresh(txn)
        return txn
    else:
        # Verification failed -> Increment attempt counter
        txn.otp_attempts += 1
        remaining = settings.otp_max_attempts - txn.otp_attempts

        if remaining <= 0:
            validate_state_transition(txn.status, "FAILED")
            txn.status = "FAILED"
            txn.otp_hash = None
            current_utc = datetime.utcnow()
            txn.finalized_at = current_utc
            txn.updated_at = current_utc
            sync_store_order_payment_status(
                db=db,
                order_id=txn.order_id,
                payment_status="FAILED",
                payment_transaction_id=txn.transaction_id,
                payment_reference=txn.payment_reference,
            )
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid OTP. Maximum verification attempts reached. Transaction marked as FAILED.",
            )
        else:
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid OTP. {remaining} attempt(s) remaining.",
            )


def resend_transaction_otp(
    db: Session,
    transaction_id: str,
    clock_offset_seconds: float = 0.0,
) -> Tuple[str, PaymentTransaction]:
    """
    Resends a fresh 6-digit OTP, enforcing backend cooldown and maximum resend limit.
    Invalidates any previous OTP hash.
    """
    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.transaction_id == transaction_id)
        .first()
    )
    if not txn:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction '{transaction_id}' not found",
        )

    if txn.status != "PENDING":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot resend OTP for transaction in '{txn.status}' state.",
        )

    # 1. Enforce maximum resend threshold
    if txn.resend_count >= settings.otp_max_resends:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=f"Maximum OTP resend limit ({settings.otp_max_resends}) reached for this transaction.",
        )

    # 2. Enforce backend resend cooldown
    now = get_current_time(clock_offset_seconds)
    if txn.last_otp_sent_at:
        elapsed = (now - txn.last_otp_sent_at).total_seconds()
        if elapsed < settings.otp_resend_cooldown_seconds:
            remaining_cooldown = max(1, int(settings.otp_resend_cooldown_seconds - elapsed))
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Please wait {remaining_cooldown} seconds before requesting a new OTP.",
            )

    # 3. Generate new OTP and invalidate previous OTP hash
    otp = generate_six_digit_otp()
    txn.otp_hash = compute_otp_hmac(txn.transaction_id, otp)
    txn.otp_expires_at = now + timedelta(minutes=settings.otp_expiry_minutes)
    txn.otp_attempts = 0
    txn.resend_count += 1
    txn.last_otp_sent_at = now

    db.commit()
    db.refresh(txn)

    return otp, txn


def get_transaction_otp_status(
    db: Session,
    transaction_id: str,
    clock_offset_seconds: float = 0.0,
) -> Dict[str, Any]:
    """Retrieves operational status of OTP for a transaction."""
    txn = (
        db.query(PaymentTransaction)
        .filter(PaymentTransaction.transaction_id == transaction_id)
        .first()
    )
    if not txn:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Transaction '{transaction_id}' not found",
        )

    now = get_current_time(clock_offset_seconds)
    is_expired = False
    expires_in_seconds = 0

    if txn.otp_expires_at:
        if now > txn.otp_expires_at:
            is_expired = True
        else:
            expires_in_seconds = max(0, int((txn.otp_expires_at - now).total_seconds()))

    remaining_attempts = max(0, settings.otp_max_attempts - txn.otp_attempts)

    # Check cooldown remaining
    cooldown_remaining_seconds = 0
    if txn.last_otp_sent_at:
        elapsed = (now - txn.last_otp_sent_at).total_seconds()
        if elapsed < settings.otp_resend_cooldown_seconds:
            cooldown_remaining_seconds = max(0, int(settings.otp_resend_cooldown_seconds - elapsed))

    return {
        "transaction_id": txn.transaction_id,
        "status": txn.status,
        "attempts_remaining": remaining_attempts,
        "resend_count": txn.resend_count,
        "is_expired": is_expired,
        "expires_in_seconds": expires_in_seconds,
        "cooldown_remaining_seconds": cooldown_remaining_seconds,
    }
