import re
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field, ConfigDict, field_validator


class SendEmailOtpRequest(BaseModel):
    email: str = Field(..., max_length=120, description="Customer email address to verify")
    session_id: Optional[str] = Field(None, max_length=64, description="Optional existing verification session ID for resend")

    @field_validator("email")
    def validate_email(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", clean):
            raise ValueError("Please enter a valid email address.")
        return clean

    model_config = ConfigDict(extra="ignore")


class SendEmailOtpResponse(BaseModel):
    session_id: str
    email: str
    message: str
    expires_in_seconds: int
    resend_count: int
    cooldown_seconds: int
    simulated_otp: Optional[str] = None


class VerifyEmailOtpRequest(BaseModel):
    session_id: str = Field(..., min_length=4, max_length=64)
    email: str = Field(..., max_length=120)
    otp: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")

    @field_validator("email")
    def validate_email(cls, v: str) -> str:
        clean = v.strip().lower()
        if not re.match(r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$", clean):
            raise ValueError("Please enter a valid email address.")
        return clean

    model_config = ConfigDict(extra="ignore")


class VerifyEmailOtpResponse(BaseModel):
    status: str
    session_id: str
    email: str
    verified: bool
    verified_at: datetime
    verification_token: str
    message: str


class EmailVerificationStatusResponse(BaseModel):
    session_id: str
    email: str
    status: str
    verified: bool
    verified_at: Optional[datetime] = None
    attempts_remaining: int
    resend_count: int
    is_expired: bool
    expires_in_seconds: int
    cooldown_remaining_seconds: int


class RetryReceiptResponse(BaseModel):
    order_id: str
    receipt_email_status: str
    receipt_email_sent_at: Optional[datetime] = None
    receipt_email_attempts: int
    message: str
