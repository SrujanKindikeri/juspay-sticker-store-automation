from fastapi import APIRouter, Depends, Header, status
from sqlalchemy.orm import Session
from app.core.config import settings
from app.database.session import get_db
from app.schemas.email_verification import (
    SendEmailOtpRequest,
    SendEmailOtpResponse,
    VerifyEmailOtpRequest,
    VerifyEmailOtpResponse,
    EmailVerificationStatusResponse,
)
from app.services.email_verification_service import (
    send_email_verification_otp,
    verify_email_otp,
    get_email_verification_status,
)

router = APIRouter(prefix="/email-verification", tags=["Email Verification"])


@router.post(
    "/send-otp",
    response_model=SendEmailOtpResponse,
    status_code=status.HTTP_200_OK,
    summary="Send Customer Email Verification OTP",
    description="Generates a cryptographically secure 6-digit OTP, stores only its keyed HMAC hash, and delivers it via SMTP.",
)
def send_email_otp_endpoint(
    payload: SendEmailOtpRequest,
    x_test_clock_offset: float = Header(0.0, alias="X-Test-Clock-Offset"),
    db: Session = Depends(get_db),
) -> SendEmailOtpResponse:
    effective_offset = x_test_clock_offset if settings.is_development else 0.0
    otp, session = send_email_verification_otp(
        db=db,
        email=payload.email,
        session_id=payload.session_id,
        clock_offset_seconds=effective_offset,
    )
    simulated_otp_value = otp if settings.is_development else None

    return SendEmailOtpResponse(
        session_id=session.session_id,
        email=session.email,
        message="Verification OTP sent to your email address.",
        expires_in_seconds=settings.otp_expiry_minutes * 60,
        resend_count=session.resend_count,
        cooldown_seconds=settings.otp_resend_cooldown_seconds,
        simulated_otp=simulated_otp_value,
    )


@router.post(
    "/verify-otp",
    response_model=VerifyEmailOtpResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify Customer Email OTP",
    description="Validates the 6-digit email OTP using constant-time HMAC comparison and marks the email verified.",
)
def verify_email_otp_endpoint(
    payload: VerifyEmailOtpRequest,
    x_test_clock_offset: float = Header(0.0, alias="X-Test-Clock-Offset"),
    db: Session = Depends(get_db),
) -> VerifyEmailOtpResponse:
    effective_offset = x_test_clock_offset if settings.is_development else 0.0
    session, verification_token = verify_email_otp(
        db=db,
        session_id=payload.session_id,
        email=payload.email,
        submitted_otp=payload.otp,
        clock_offset_seconds=effective_offset,
    )

    return VerifyEmailOtpResponse(
        status=session.status,
        session_id=session.session_id,
        email=session.email,
        verified=True,
        verified_at=session.verified_at,
        verification_token=verification_token,
        message="Email address verified successfully.",
    )


@router.get(
    "/status/{session_id}",
    response_model=EmailVerificationStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Get Email Verification Session Status",
)
def get_email_verification_status_endpoint(
    session_id: str,
    x_test_clock_offset: float = Header(0.0, alias="X-Test-Clock-Offset"),
    db: Session = Depends(get_db),
) -> EmailVerificationStatusResponse:
    effective_offset = x_test_clock_offset if settings.is_development else 0.0
    data = get_email_verification_status(
        db=db,
        session_id=session_id,
        clock_offset_seconds=effective_offset,
    )
    return EmailVerificationStatusResponse(**data)
