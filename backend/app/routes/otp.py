import logging
from fastapi import APIRouter, Depends, Header, status
from sqlalchemy.orm import Session
from app.database.session import get_db
from app.core.config import settings
from app.schemas.otp import (
    SendOtpResponse,
    VerifyOtpRequest,
    VerifyOtpResponse,
    ResendOtpResponse,
    OtpStatusResponse,
)
from app.services.otp_service import (
    send_otp_for_transaction,
    verify_transaction_otp,
    resend_transaction_otp,
    get_transaction_otp_status,
)

logger = logging.getLogger("juspay.otp")

router = APIRouter(prefix="/payments", tags=["OTP Verification"])


@router.post(
    "/{transaction_id}/send-otp",
    response_model=SendOtpResponse,
    status_code=status.HTTP_200_OK,
    summary="Send OTP for Payment",
    description="Generates a 6-digit secure OTP, binds it to the transaction with keyed HMAC-SHA256, and stores only the hash.",
)
def send_otp(
    transaction_id: str,
    db: Session = Depends(get_db),
) -> SendOtpResponse:
    """Endpoint: POST /api/v1/payments/{transaction_id}/send-otp"""
    otp, txn = send_otp_for_transaction(db=db, transaction_id=transaction_id)
    # Strictly log only the transaction identifier, never the plaintext OTP
    logger.info(f"OTP generated for transaction {transaction_id}")

    # Simulated OTP is returned ONLY in development mode for automation/UI demo; strictly None in production
    simulated_otp_value = otp if settings.is_development else None

    return SendOtpResponse(
        transaction_id=txn.transaction_id,
        message="OTP sent successfully to simulated customer",
        masked_contact="+91 ******8812 / te****@juspay.demo",
        expires_in_seconds=settings.otp_expiry_minutes * 60,
        simulated_otp=simulated_otp_value,
    )


@router.post(
    "/{transaction_id}/verify-otp",
    response_model=VerifyOtpResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify OTP",
    description="Verifies the submitted 6-digit OTP using constant-time comparison against keyed HMAC. Transitions status to AUTHENTICATED on match or FAILED after 3 attempts.",
)
def verify_otp(
    transaction_id: str,
    payload: VerifyOtpRequest,
    x_test_clock_offset: float = Header(0.0, alias="X-Test-Clock-Offset"),
    db: Session = Depends(get_db),
) -> VerifyOtpResponse:
    """Endpoint: POST /api/v1/payments/{transaction_id}/verify-otp"""
    txn = verify_transaction_otp(
        db=db,
        transaction_id=transaction_id,
        submitted_otp=payload.otp,
        clock_offset_seconds=x_test_clock_offset,
    )
    logger.info(f"OTP verified successfully for transaction {transaction_id}. Status: {txn.status}")

    return VerifyOtpResponse(
        status=txn.status,
        message="OTP verified successfully. Transaction is AUTHENTICATED.",
        transaction_id=txn.transaction_id,
        payment_reference=txn.payment_reference,
        amount=txn.amount,
        currency=txn.currency,
    )


@router.post(
    "/{transaction_id}/resend-otp",
    response_model=ResendOtpResponse,
    status_code=status.HTTP_200_OK,
    summary="Resend OTP",
    description="Generates a fresh 6-digit OTP for the transaction, invalidating the previous OTP and resetting attempts. Enforces 30s cooldown and max 3 resends.",
)
def resend_otp(
    transaction_id: str,
    x_test_clock_offset: float = Header(0.0, alias="X-Test-Clock-Offset"),
    db: Session = Depends(get_db),
) -> ResendOtpResponse:
    """Endpoint: POST /api/v1/payments/{transaction_id}/resend-otp"""
    otp, txn = resend_transaction_otp(
        db=db,
        transaction_id=transaction_id,
        clock_offset_seconds=x_test_clock_offset,
    )
    # Strictly log only the transaction identifier, never the plaintext OTP
    logger.info(f"OTP resent for transaction {transaction_id} (count: {txn.resend_count})")

    # Simulated OTP is returned ONLY in development mode for automation/UI demo; strictly None in production
    simulated_otp_value = otp if settings.is_development else None

    return ResendOtpResponse(
        transaction_id=txn.transaction_id,
        message="A new OTP has been dispatched to simulated contact",
        resend_count=txn.resend_count,
        expires_in_seconds=settings.otp_expiry_minutes * 60,
        simulated_otp=simulated_otp_value,
    )


@router.get(
    "/{transaction_id}/otp-status",
    response_model=OtpStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Get OTP Status",
    description="Returns remaining verification attempts, expiry status, cooldown remaining, and resend count.",
)
def get_otp_status(
    transaction_id: str,
    x_test_clock_offset: float = Header(0.0, alias="X-Test-Clock-Offset"),
    db: Session = Depends(get_db),
) -> OtpStatusResponse:
    """Endpoint: GET /api/v1/payments/{transaction_id}/otp-status"""
    status_data = get_transaction_otp_status(
        db=db,
        transaction_id=transaction_id,
        clock_offset_seconds=x_test_clock_offset,
    )
    return OtpStatusResponse(**status_data)
