import hmac
import hashlib
import logging
import secrets
import uuid
from datetime import datetime, timedelta
from typing import Optional, Tuple
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.core.clock import get_current_time
from app.models.email_verification import EmailVerificationSession
from app.services.email_service import send_email_verification_otp_email

logger = logging.getLogger("juspay.email_verification")


def _mask_email(email: str) -> str:
    if "@" not in email:
        return "***"
    local, domain = email.split("@", 1)
    prefix = local[:2] if len(local) >= 2 else local[:1]
    return f"{prefix}***@{domain}"


def _generate_six_digit_otp() -> str:
    """Generates a cryptographically secure 6-digit OTP (100000 - 999999)."""
    return str(secrets.randbelow(900000) + 100000)


def compute_email_otp_hmac(session_id: str, email: str, otp: str) -> str:
    """
    Computes keyed HMAC-SHA256 binding session_id, normalized email, and OTP.
    Prevents cross-email and cross-session replay.
    """
    secret_key = settings.otp_secret_key.encode("utf-8")
    message = f"EMAIL_OTP:{session_id}:{email.strip().lower()}:{otp}".encode("utf-8")
    return hmac.new(secret_key, message, hashlib.sha256).hexdigest()


def compute_verification_token_hmac(session_id: str, email: str, token: str) -> str:
    """Computes keyed HMAC-SHA256 for post-verification proof token."""
    secret_key = settings.otp_secret_key.encode("utf-8")
    message = f"EMAIL_PROOF:{session_id}:{email.strip().lower()}:{token}".encode("utf-8")
    return hmac.new(secret_key, message, hashlib.sha256).hexdigest()


def send_email_verification_otp(
    db: Session,
    email: str,
    session_id: Optional[str] = None,
    clock_offset_seconds: float = 0.0,
) -> Tuple[str, EmailVerificationSession]:
    """
    Issues or resends a 6-digit email verification OTP for checkout email verification.
    - Stores ONLY keyed HMAC-SHA256 hash.
    - Enforces 30-second resend cooldown and max 3 resend attempts when reusing a session.
    - Invalidates previous OTP immediately upon issuing a new one.
    """
    normalized_email = email.strip().lower()
    now = get_current_time(clock_offset_seconds)

    session: Optional[EmailVerificationSession] = None
    is_resend = False

    if session_id:
        session = (
            db.query(EmailVerificationSession)
            .filter(EmailVerificationSession.session_id == session_id)
            .first()
        )
        if not session:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Email verification session not found.",
            )
        if session.email != normalized_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email verification session belongs to a different email address. Please start a new verification.",
            )
        if session.status == "VERIFIED":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="This email address is already verified for this session.",
            )
        is_resend = session.last_otp_sent_at is not None

    if is_resend and session:
        if session.resend_count >= settings.otp_max_resends:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Maximum email OTP resend limit ({settings.otp_max_resends}) reached. Please start a new session.",
            )
        if session.last_otp_sent_at:
            elapsed = (now - session.last_otp_sent_at).total_seconds()
            if elapsed < settings.otp_resend_cooldown_seconds:
                remaining = max(1, int(settings.otp_resend_cooldown_seconds - elapsed))
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Please wait {remaining} seconds before resending the email verification OTP.",
                )

    otp = _generate_six_digit_otp()

    if not session:
        new_session_id = f"EVS_{uuid.uuid4().hex[:14].upper()}"
        session = EmailVerificationSession(
            session_id=new_session_id,
            email=normalized_email,
            status="PENDING",
            otp_attempts=0,
            resend_count=0,
        )
        db.add(session)
    else:
        session.resend_count += 1
        session.status = "PENDING"
        session.otp_attempts = 0
        session.verification_token_hash = None

    # Store only keyed HMAC-SHA256 digest (invalidates any previous OTP)
    session.otp_hash = compute_email_otp_hmac(session.session_id, normalized_email, otp)
    session.otp_expires_at = now + timedelta(minutes=settings.otp_expiry_minutes)
    session.last_otp_sent_at = now
    session.updated_at = now

    try:
        send_email_verification_otp_email(
            to_email=normalized_email,
            otp_code=otp,
            expires_minutes=settings.otp_expiry_minutes,
        )
    except Exception as exc:
        db.rollback()
        logger.error(f"Email OTP dispatch failed for {_mask_email(normalized_email)}: {type(exc).__name__}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Unable to send verification email at the moment. Please try again shortly.",
        )

    db.commit()
    db.refresh(session)
    logger.info(f"Email verification OTP issued for session {session.session_id} ({_mask_email(normalized_email)})")
    return otp, session


def verify_email_otp(
    db: Session,
    session_id: str,
    email: str,
    submitted_otp: str,
    clock_offset_seconds: float = 0.0,
) -> Tuple[EmailVerificationSession, str]:
    """
    Verifies a submitted 6-digit email OTP using constant-time HMAC comparison.
    - Prevents verifying a different email using an OTP issued to another address.
    - Enforces 5-minute expiry and 3-attempt lockout.
    - Returns (verified_session, proof_token).
    """
    normalized_email = email.strip().lower()
    session = (
        db.query(EmailVerificationSession)
        .filter(EmailVerificationSession.session_id == session_id)
        .first()
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email verification session not found.",
        )

    # Enforce strict binding between email and session
    if session.email != normalized_email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Email address does not match the verification session. Cross-email verification is forbidden.",
        )

    if session.status == "VERIFIED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This email verification session has already been verified.",
        )

    if session.status != "PENDING" or not session.otp_hash or not session.otp_expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Email verification session is '{session.status}'. Please request a new verification OTP.",
        )

    now = get_current_time(clock_offset_seconds)
    if now > session.otp_expires_at:
        session.status = "EXPIRED"
        session.otp_hash = None
        session.updated_at = now
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email verification OTP has expired. Please request a new OTP.",
        )

    if session.otp_attempts >= settings.otp_max_attempts:
        session.status = "FAILED"
        session.otp_hash = None
        session.updated_at = now
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum email OTP verification attempts exceeded. Session locked.",
        )

    expected_hash = compute_email_otp_hmac(session.session_id, normalized_email, submitted_otp.strip())
    if not hmac.compare_digest(expected_hash, session.otp_hash):
        session.otp_attempts += 1
        session.updated_at = now
        remaining = max(0, settings.otp_max_attempts - session.otp_attempts)

        if session.otp_attempts >= settings.otp_max_attempts:
            session.status = "FAILED"
            session.otp_hash = None
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Maximum incorrect email OTP attempts (3/3) reached. Verification failed; please resend OTP.",
            )

        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid email OTP. {remaining} attempt(s) remaining.",
        )

    # Verification succeeded! Generate proof token & clear OTP hash immediately
    verification_token = secrets.token_urlsafe(32)
    session.status = "VERIFIED"
    session.verified_at = now
    session.otp_hash = None
    session.verification_token_hash = compute_verification_token_hmac(
        session.session_id, normalized_email, verification_token
    )
    session.updated_at = now

    db.commit()
    db.refresh(session)
    logger.info(f"Email verified for session {session.session_id} ({_mask_email(normalized_email)})")
    return session, verification_token


def get_email_verification_status(
    db: Session,
    session_id: str,
    clock_offset_seconds: float = 0.0,
) -> dict:
    session = (
        db.query(EmailVerificationSession)
        .filter(EmailVerificationSession.session_id == session_id)
        .first()
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Email verification session not found.",
        )

    now = get_current_time(clock_offset_seconds)
    is_expired = bool(session.otp_expires_at and now > session.otp_expires_at)
    expires_in = max(0, int((session.otp_expires_at - now).total_seconds())) if session.otp_expires_at and not is_expired else 0

    cooldown_remaining = 0
    if session.last_otp_sent_at:
        elapsed = (now - session.last_otp_sent_at).total_seconds()
        if elapsed < settings.otp_resend_cooldown_seconds:
            cooldown_remaining = max(1, int(settings.otp_resend_cooldown_seconds - elapsed))

    return {
        "session_id": session.session_id,
        "email": session.email,
        "status": session.status,
        "verified": session.status == "VERIFIED",
        "verified_at": session.verified_at,
        "attempts_remaining": max(0, settings.otp_max_attempts - session.otp_attempts),
        "resend_count": session.resend_count,
        "is_expired": is_expired,
        "expires_in_seconds": expires_in,
        "cooldown_remaining_seconds": cooldown_remaining,
    }


def assert_email_verified_for_order(
    db: Session,
    email: str,
    session_id: Optional[str],
    verification_token: Optional[str],
) -> EmailVerificationSession:
    """
    Server-side enforcement ensuring orders can only be created with a genuinely
    verified email session matching the submitted customer email.
    """
    normalized_email = email.strip().lower()

    if not session_id or not verification_token:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Customer email must be verified before placing an order.",
        )

    session = (
        db.query(EmailVerificationSession)
        .filter(EmailVerificationSession.session_id == session_id)
        .first()
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid email verification session. Please verify your email address.",
        )

    if session.email != normalized_email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Order email does not match the verified email address.",
        )

    if session.status != "VERIFIED" or not session.verification_token_hash:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Customer email is not verified. Please complete email OTP verification.",
        )

    expected_token_hash = compute_verification_token_hmac(
        session.session_id, normalized_email, verification_token
    )
    if not hmac.compare_digest(expected_token_hash, session.verification_token_hash):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid email verification token. Please re-verify your email address.",
        )

    return session
