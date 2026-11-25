from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator


class SendOtpResponse(BaseModel):
    """Response returned when an OTP is sent."""
    transaction_id: str = Field(..., description="Unique transaction ID")
    message: str = Field(..., description="Human-readable notification message")
    masked_contact: str = Field(..., description="Masked recipient contact info")
    expires_in_seconds: int = Field(default=300, description="OTP validity in seconds")
    simulated_otp: Optional[str] = Field(None, description="Simulated OTP provided for testing/demo")

    model_config = ConfigDict(from_attributes=True)


class VerifyOtpRequest(BaseModel):
    """Payload to verify a 6-digit OTP."""
    otp: str = Field(..., description="6-digit verification code")

    @field_validator("otp")
    @classmethod
    def validate_otp_format(cls, v: str) -> str:
        clean = v.strip()
        if not (clean.isdigit() and len(clean) == 6):
            raise ValueError("OTP must be exactly 6 numeric digits")
        return clean


class VerifyOtpResponse(BaseModel):
    """Response returned upon successful OTP verification (AUTHENTICATED status)."""
    status: str = Field(default="AUTHENTICATED", description="Transaction status (AUTHENTICATED)")
    message: str = Field(..., description="Result message")
    transaction_id: str = Field(..., description="Transaction ID")
    payment_reference: str = Field(..., description="Payment reference")
    amount: float = Field(..., description="Processed amount")
    currency: str = Field(..., description="Currency code")

    model_config = ConfigDict(from_attributes=True)


class ResendOtpResponse(BaseModel):
    """Response returned when a new OTP is requested."""
    transaction_id: str = Field(..., description="Transaction ID")
    message: str = Field(..., description="Notification message")
    resend_count: int = Field(..., description="Number of times OTP was resent")
    expires_in_seconds: int = Field(default=300, description="Validity period in seconds")
    simulated_otp: Optional[str] = Field(None, description="Simulated OTP provided for testing/demo")

    model_config = ConfigDict(from_attributes=True)


class OtpStatusResponse(BaseModel):
    """Status query response for a transaction's OTP state."""
    transaction_id: str = Field(..., description="Transaction ID")
    status: str = Field(..., description="Current transaction lifecycle status")
    attempts_remaining: int = Field(..., description="Remaining verification attempts")
    resend_count: int = Field(..., description="Times OTP has been resent")
    is_expired: bool = Field(..., description="Whether current OTP has expired")
    expires_in_seconds: int = Field(..., description="Seconds until expiration")
    cooldown_remaining_seconds: int = Field(default=0, description="Seconds until resend is permitted")

    model_config = ConfigDict(from_attributes=True)
