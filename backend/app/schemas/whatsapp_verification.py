from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict, Field


class WhatsAppAvailabilityResponse(BaseModel):
    enabled: bool
    experimental: bool
    provider: str
    connected: bool
    available: bool
    message: str


class WhatsAppAdminStatusResponse(BaseModel):
    provider: str
    enabled: bool
    experimental: bool
    sender_name: str
    session_id: str
    status: str
    connected: bool
    has_qr: bool
    has_saved_session: bool
    connected_phone_masked: Optional[str] = None
    last_connected_at: Optional[str] = None
    last_disconnected_at: Optional[str] = None
    reconnect_attempts: int = 0
    last_error: Optional[str] = None


class WhatsAppAdminQrResponse(BaseModel):
    status: str
    connected: bool
    has_qr: bool
    qr_data_url: Optional[str] = None
    qr_generated_at: Optional[str] = None
    message: str


class WhatsAppDisconnectRequest(BaseModel):
    logout: bool = False
    model_config = ConfigDict(extra="ignore")


class WhatsAppSendTestRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=24, description="Authorized recipient phone number")
    message: str = Field(
        default="Stickora Store experimental WhatsApp test message. No action required.",
        min_length=1,
        max_length=500,
    )
    model_config = ConfigDict(extra="ignore")


class WhatsAppSendTestResponse(BaseModel):
    accepted: bool
    provider: str
    message_id: str
    ack_status: str
    recipient_masked: str
    timestamp: str


class SendWhatsAppOtpRequest(BaseModel):
    phone: str = Field(..., min_length=8, max_length=24, description="Customer WhatsApp mobile number")
    session_id: Optional[str] = Field(None, max_length=64, description="Optional existing session ID for resend")
    model_config = ConfigDict(extra="ignore")


class SendWhatsAppOtpResponse(BaseModel):
    session_id: str
    phone_masked: str
    provider: str
    experimental: bool
    delivery_status: str
    provider_message_id: Optional[str] = None
    message: str
    expires_in_seconds: int
    resend_count: int
    cooldown_seconds: int


class VerifyWhatsAppOtpRequest(BaseModel):
    session_id: str = Field(..., min_length=4, max_length=64)
    phone: str = Field(..., min_length=8, max_length=24)
    otp: str = Field(..., min_length=6, max_length=6, pattern=r"^\d{6}$")
    model_config = ConfigDict(extra="ignore")


class VerifyWhatsAppOtpResponse(BaseModel):
    status: str
    session_id: str
    phone_masked: str
    verified: bool
    verified_at: datetime
    verification_token: str
    message: str


class WhatsAppVerificationStatusResponse(BaseModel):
    session_id: str
    phone_masked: str
    status: str
    verified: bool
    verified_at: Optional[datetime] = None
    attempts_remaining: int
    resend_count: int
    is_expired: bool
    expires_in_seconds: int
    cooldown_remaining_seconds: int
