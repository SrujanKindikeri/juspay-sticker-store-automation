from datetime import datetime
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.database.session import get_db
from app.schemas.whatsapp_verification import (
    SendWhatsAppOtpRequest,
    SendWhatsAppOtpResponse,
    VerifyWhatsAppOtpRequest,
    VerifyWhatsAppOtpResponse,
    WhatsAppAvailabilityResponse,
    WhatsAppVerificationStatusResponse,
)
from app.services.whatsapp_provider import WhatsAppProviderError, get_whatsapp_provider
from app.services.whatsapp_verification_service import (
    get_whatsapp_verification_status,
    send_whatsapp_verification_otp,
    verify_whatsapp_otp,
)

router = APIRouter(prefix="/verification/whatsapp", tags=["WhatsApp Verification"])


@router.get(
    "/availability",
    response_model=WhatsAppAvailabilityResponse,
    summary="Check Customer Checkout WhatsApp OTP Availability",
    description="Safely checks whether experimental WhatsApp OTP verification is enabled and linked, without exposing admin, phone, or QR details.",
)
def check_whatsapp_availability() -> WhatsAppAvailabilityResponse:
    if not settings.whatsapp_enabled:
        return WhatsAppAvailabilityResponse(
            enabled=False,
            experimental=settings.whatsapp_experimental,
            provider=settings.whatsapp_provider,
            connected=False,
            available=False,
            message="WhatsApp verification is disabled.",
        )

    if not settings.whatsapp_dispatch_enabled:
        return WhatsAppAvailabilityResponse(
            enabled=True,
            experimental=settings.whatsapp_experimental,
            provider=settings.whatsapp_provider,
            connected=False,
            available=False,
            message="WhatsApp dispatch is disabled in this environment.",
        )

    try:
        status_res = get_whatsapp_provider().get_status()
        connected = bool(status_res.connected)
        msg = (
            "Experimental WhatsApp OTP verification is online."
            if connected
            else "WhatsApp service is offline or awaiting merchant linking. You can verify via Email OTP."
        )
        return WhatsAppAvailabilityResponse(
            enabled=True,
            experimental=bool(status_res.experimental),
            provider=status_res.provider,
            connected=connected,
            available=connected,
            message=msg,
        )
    except WhatsAppProviderError:
        return WhatsAppAvailabilityResponse(
            enabled=True,
            experimental=settings.whatsapp_experimental,
            provider=settings.whatsapp_provider,
            connected=False,
            available=False,
            message="WhatsApp service is currently unavailable. Please use Email OTP.",
        )


@router.post(
    "/send-otp",
    response_model=SendWhatsAppOtpResponse,
    status_code=status.HTTP_200_OK,
    summary="Send Customer WhatsApp Verification OTP",
)
def send_whatsapp_otp_route(
    request: SendWhatsAppOtpRequest,
    raw_request: Request,
    db: Session = Depends(get_db),
) -> SendWhatsAppOtpResponse:
    client_ip = raw_request.client.host if raw_request.client else None
    session, ack_status = send_whatsapp_verification_otp(
        db=db,
        raw_phone=request.phone,
        existing_session_id=request.session_id,
        client_ip=client_ip,
    )
    return SendWhatsAppOtpResponse(
        session_id=session.session_id,
        phone_masked=session.phone_masked,
        provider=session.provider,
        experimental=settings.whatsapp_experimental,
        delivery_status=ack_status,
        provider_message_id=session.provider_message_id,
        message=f"Verification code submitted via WhatsApp ({ack_status}). Check your WhatsApp messages.",
        expires_in_seconds=settings.otp_expiry_minutes * 60,
        resend_count=session.resend_count,
        cooldown_seconds=settings.otp_resend_cooldown_seconds,
    )


@router.post(
    "/verify-otp",
    response_model=VerifyWhatsAppOtpResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify Customer WhatsApp OTP",
)
def verify_whatsapp_otp_route(
    request: VerifyWhatsAppOtpRequest,
    db: Session = Depends(get_db),
) -> VerifyWhatsAppOtpResponse:
    session, verification_token = verify_whatsapp_otp(
        db=db,
        session_id=request.session_id,
        raw_phone=request.phone,
        submitted_otp=request.otp,
    )
    return VerifyWhatsAppOtpResponse(
        status=session.status,
        session_id=session.session_id,
        phone_masked=session.phone_masked,
        verified=True,
        verified_at=session.verified_at,
        verification_token=verification_token,
        message="WhatsApp number verified successfully.",
    )


@router.get(
    "/status/{session_id}",
    response_model=WhatsAppVerificationStatusResponse,
    summary="Check WhatsApp Verification Session Status",
)
def get_whatsapp_status_route(
    session_id: str,
    db: Session = Depends(get_db),
) -> WhatsAppVerificationStatusResponse:
    session = get_whatsapp_verification_status(db=db, session_id=session_id)
    now = datetime.utcnow()
    is_expired = session.status == "EXPIRED" or bool(
        session.otp_expires_at and now > session.otp_expires_at and session.status == "PENDING"
    )
    expires_in = max(0, int((session.otp_expires_at - now).total_seconds())) if session.otp_expires_at else 0
    cooldown_remaining = 0
    if session.last_otp_sent_at:
        elapsed = (now - session.last_otp_sent_at).total_seconds()
        if elapsed < settings.otp_resend_cooldown_seconds:
            cooldown_remaining = int(settings.otp_resend_cooldown_seconds - elapsed) + 1

    return WhatsAppVerificationStatusResponse(
        session_id=session.session_id,
        phone_masked=session.phone_masked,
        status=session.status,
        verified=session.status in ("VERIFIED", "CONSUMED"),
        verified_at=session.verified_at,
        attempts_remaining=max(0, settings.otp_max_attempts - session.otp_attempts),
        resend_count=session.resend_count,
        is_expired=is_expired,
        expires_in_seconds=expires_in,
        cooldown_remaining_seconds=cooldown_remaining,
    )
