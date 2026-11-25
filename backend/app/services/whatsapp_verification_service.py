from datetime import datetime, timedelta
import hashlib
import hmac
import logging
import secrets
import uuid
from typing import Optional, Tuple
from fastapi import HTTPException, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.models.whatsapp_verification import WhatsAppVerificationSession
from app.services.whatsapp_provider import (
    WhatsAppProviderError,
    get_whatsapp_provider,
    normalize_whatsapp_phone,
)

logger = logging.getLogger("juspay.whatsapp_verification")


def compute_whatsapp_otp_hmac(session_id: str, phone_e164: str, otp: str) -> str:
    """Computes a keyed HMAC-SHA256 bound to session ID and normalized E.164 phone number."""
    payload = f"WA_OTP:{session_id}:{phone_e164}:{otp}".encode("utf-8")
    return hmac.new(settings.otp_secret_key.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_whatsapp_otp_hmac(session_id: str, phone_e164: str, submitted_otp: str, stored_hash: str) -> bool:
    """Constant-time verification against stored HMAC hash."""
    if not stored_hash or not submitted_otp:
        return False
    expected = compute_whatsapp_otp_hmac(session_id, phone_e164, submitted_otp)
    return hmac.compare_digest(expected, stored_hash)


def compute_whatsapp_token_hmac(session_id: str, phone_e164: str, token: str) -> str:
    payload = f"WA_VERIFIED_TOKEN:{session_id}:{phone_e164}:{token}".encode("utf-8")
    return hmac.new(settings.otp_secret_key.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def verify_whatsapp_token_hmac(session_id: str, phone_e164: str, token: str, stored_hash: Optional[str]) -> bool:
    if not token or not stored_hash:
        return False
    expected = compute_whatsapp_token_hmac(session_id, phone_e164, token)
    return hmac.compare_digest(expected, stored_hash)


def _enforce_rate_limit(db: Session, phone_e164: str, client_ip: Optional[str]) -> None:
    window_start = datetime.utcnow() - timedelta(seconds=settings.whatsapp_rate_limit_window_seconds)
    recent_phone_count = (
        db.query(WhatsAppVerificationSession)
        .filter(
            WhatsAppVerificationSession.phone_e164 == phone_e164,
            WhatsAppVerificationSession.created_at >= window_start,
        )
        .count()
    )
    if recent_phone_count >= settings.whatsapp_rate_limit_max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many WhatsApp verification requests for this phone number. Please wait before trying again.",
        )

    if client_ip:
        recent_ip_count = (
            db.query(WhatsAppVerificationSession)
            .filter(
                WhatsAppVerificationSession.client_ip == client_ip,
                WhatsAppVerificationSession.created_at >= window_start,
            )
            .count()
        )
        if recent_ip_count >= settings.whatsapp_rate_limit_max_requests * 2:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many WhatsApp verification requests from this client. Please try again later.",
            )


def send_whatsapp_verification_otp(
    db: Session,
    raw_phone: str,
    existing_session_id: Optional[str] = None,
    client_ip: Optional[str] = None,
) -> Tuple[WhatsAppVerificationSession, str]:
    """
    Generates a secure 6-digit OTP, stores only its HMAC hash, dispatches it through
    the configured WhatsAppProvider (when dispatch is enabled), and records provider acknowledgement.
    """
    if not settings.whatsapp_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="WhatsApp OTP verification is currently disabled.",
        )

    if not settings.whatsapp_dispatch_enabled:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Real WhatsApp message dispatch is disabled in this environment.",
        )

    phone_e164, phone_masked = normalize_whatsapp_phone(raw_phone)

    # Verify live BerryProtocol connection BEFORE creating/consuming session state or generating OTP
    provider = get_whatsapp_provider()
    status_res = provider.get_status()
    if not status_res.enabled or not status_res.connected:
        raise WhatsAppProviderError(
            f"Merchant WhatsApp session is not connected (status: {status_res.status}). "
            "Link WhatsApp on the merchant admin page or verify using Email OTP.",
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "WHATSAPP_DISCONNECTED",
        )

    now = datetime.utcnow()
    session: Optional[WhatsAppVerificationSession] = None

    if existing_session_id:
        session = (
            db.query(WhatsAppVerificationSession)
            .filter(
                WhatsAppVerificationSession.session_id == existing_session_id,
                WhatsAppVerificationSession.phone_e164 == phone_e164,
            )
            .first()
        )

    if session and session.status not in ("CONSUMED", "VERIFIED", "FAILED"):
        if session.resend_count >= settings.otp_max_resends:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Maximum WhatsApp OTP resend limit ({settings.otp_max_resends}) reached. Please wait or use Email verification.",
            )
        if session.last_otp_sent_at:
            elapsed = (now - session.last_otp_sent_at).total_seconds()
            if elapsed < settings.otp_resend_cooldown_seconds:
                remaining = int(settings.otp_resend_cooldown_seconds - elapsed) + 1
                raise HTTPException(
                    status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                    detail=f"Please wait {remaining} seconds before resending a WhatsApp OTP.",
                )
        # Invalidate prior OTP immediately before issuing replacement OTP on same session
        session.otp_hash = None
        session.otp_attempts = 0
        session.resend_count += 1
        session.status = "PENDING"
    else:
        _enforce_rate_limit(db, phone_e164, client_ip)
        # Invalidate any earlier PENDING verification sessions for this phone
        prior_pending = (
            db.query(WhatsAppVerificationSession)
            .filter(
                WhatsAppVerificationSession.phone_e164 == phone_e164,
                WhatsAppVerificationSession.status == "PENDING",
            )
            .all()
        )
        for prior in prior_pending:
            prior.status = "EXPIRED"
            prior.otp_hash = None

        session = WhatsAppVerificationSession(
            session_id=f"WVS_{uuid.uuid4().hex[:14].upper()}",
            phone_e164=phone_e164,
            phone_masked=phone_masked,
            client_ip=client_ip,
            status="PENDING",
            otp_attempts=0,
            resend_count=0,
            provider=settings.whatsapp_provider,
        )
        db.add(session)

    otp = f"{secrets.randbelow(900000) + 100000}"
    session.otp_hash = compute_whatsapp_otp_hmac(session.session_id, phone_e164, otp)
    session.otp_expires_at = now + timedelta(minutes=settings.otp_expiry_minutes)
    session.last_otp_sent_at = now

    try:
        dispatch_result = provider.send_otp(
            phone_e164=phone_e164,
            otp=otp,
            expiry_minutes=settings.otp_expiry_minutes,
        )
    except WhatsAppProviderError:
        db.rollback()
        raise

    if not dispatch_result.accepted or not dispatch_result.message_id:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="WhatsApp provider did not confirm OTP dispatch.",
        )

    session.provider = dispatch_result.provider
    session.provider_message_id = dispatch_result.message_id
    session.delivery_ack_status = dispatch_result.ack_status

    db.commit()
    db.refresh(session)

    # Strictly log ONLY masked identifier and provider message ID — never plaintext OTP or full personal phone
    logger.info(
        f"WhatsApp OTP dispatched session={session.session_id} phone={phone_masked} msg_id={dispatch_result.message_id} ack={dispatch_result.ack_status}"
    )
    return session, dispatch_result.ack_status


def verify_whatsapp_otp(
    db: Session,
    session_id: str,
    raw_phone: str,
    submitted_otp: str,
) -> Tuple[WhatsAppVerificationSession, str]:
    """
    Validates submitted 6-digit OTP in constant time.
    Enforces expiry and max 3 incorrect attempts.
    """
    phone_e164, _ = normalize_whatsapp_phone(raw_phone)
    session = (
        db.query(WhatsAppVerificationSession)
        .filter(WhatsAppVerificationSession.session_id == session_id)
        .first()
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="WhatsApp verification session not found.",
        )

    if session.phone_e164 != phone_e164:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Phone number does not match this WhatsApp verification session.",
        )

    if session.status == "CONSUMED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This WhatsApp verification session has already been used for an order.",
        )

    if session.status == "FAILED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Verification locked after maximum incorrect attempts. Please request a new OTP.",
        )

    if session.status == "EXPIRED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This verification code has been superseded or expired. Please request a new OTP.",
        )

    now = datetime.utcnow()
    if not session.otp_expires_at or now > session.otp_expires_at:
        session.status = "EXPIRED"
        session.otp_hash = None
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="WhatsApp verification OTP has expired. Please request a new code.",
        )

    if session.otp_attempts >= settings.otp_max_attempts:
        session.status = "FAILED"
        session.otp_hash = None
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Maximum OTP attempts exceeded. Please request a new WhatsApp OTP.",
        )

    if not verify_whatsapp_otp_hmac(session.session_id, phone_e164, submitted_otp, session.otp_hash or ""):
        session.otp_attempts += 1
        remaining = max(0, settings.otp_max_attempts - session.otp_attempts)
        if session.otp_attempts >= settings.otp_max_attempts:
            session.status = "FAILED"
            session.otp_hash = None
            db.commit()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Incorrect WhatsApp OTP. Maximum attempts exceeded; please request a new OTP.",
            )
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid WhatsApp OTP. {remaining} attempt(s) remaining.",
        )

    verification_token = secrets.token_urlsafe(32)
    session.status = "VERIFIED"
    session.verified_at = now
    session.otp_hash = None
    session.verification_token_hash = compute_whatsapp_token_hmac(session.session_id, phone_e164, verification_token)
    db.commit()
    db.refresh(session)

    logger.info(f"WhatsApp verified session={session.session_id} phone={session.phone_masked}")
    return session, verification_token


def get_whatsapp_verification_status(db: Session, session_id: str) -> WhatsAppVerificationSession:
    session = (
        db.query(WhatsAppVerificationSession)
        .filter(WhatsAppVerificationSession.session_id == session_id)
        .first()
    )
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="WhatsApp verification session not found.",
        )
    return session


def assert_whatsapp_verified_for_order(
    db: Session,
    phone: str,
    session_id: Optional[str],
    verification_token: Optional[str],
) -> WhatsAppVerificationSession:
    """
    Server-side enforcement guaranteeing checkout cannot place a WhatsApp-verified order
    without valid OTP proof matching the delivery mobile number.
    """
    if not session_id or not verification_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="WhatsApp verification is required before placing this order.",
        )

    phone_e164, _ = normalize_whatsapp_phone(phone)
    session = (
        db.query(WhatsAppVerificationSession)
        .filter(WhatsAppVerificationSession.session_id == session_id)
        .with_for_update()
        .first()
    )
    if not session or session.phone_e164 != phone_e164:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="WhatsApp verification does not match the delivery mobile number.",
        )

    if session.status == "CONSUMED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="WhatsApp verification proof has already been used for another order.",
        )

    if session.status != "VERIFIED" or not session.verified_at:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Mobile number is not verified yet. Complete WhatsApp OTP verification first.",
        )

    if not verify_whatsapp_token_hmac(session.session_id, phone_e164, verification_token, session.verification_token_hash):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid WhatsApp verification token.",
        )

    return session
