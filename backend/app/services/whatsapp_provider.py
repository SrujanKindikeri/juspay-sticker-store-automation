from abc import ABC, abstractmethod
from dataclasses import dataclass
import re
from typing import Optional, Tuple
import httpx
from fastapi import HTTPException, status
from app.core.config import settings


class WhatsAppProviderError(HTTPException):
    """Typed HTTP-friendly exception raised by WhatsApp providers."""

    def __init__(self, detail: str, status_code: int = status.HTTP_503_SERVICE_UNAVAILABLE, code: str = "WHATSAPP_ERROR"):
        super().__init__(status_code=status_code, detail=detail)
        self.code = code


def normalize_whatsapp_phone(raw_phone: str) -> Tuple[str, str]:
    """
    Normalizes an Indian 10-digit or E.164 international phone number into (e164, masked).
    Raises WhatsAppProviderError (400) on invalid numbers.
    """
    if not raw_phone or not isinstance(raw_phone, str):
        raise WhatsAppProviderError("WhatsApp phone number is required.", status.HTTP_400_BAD_REQUEST, "INVALID_PHONE")

    cleaned = raw_phone.strip()
    if cleaned.startswith("00"):
        cleaned = "+" + cleaned[2:]

    stripped = re.sub(r"[\s\-().]", "", cleaned)
    has_plus = stripped.startswith("+")
    digits = re.sub(r"\D", "", stripped)

    if not digits:
        raise WhatsAppProviderError("WhatsApp phone number is invalid.", status.HTTP_400_BAD_REQUEST, "INVALID_PHONE")

    if not has_plus and len(digits) == 10:
        if not re.match(r"^[6-9]\d{9}$", digits):
            raise WhatsAppProviderError(
                "Enter a valid 10-digit Indian mobile number (starting with 6-9) or E.164 format (+91...).",
                status.HTTP_400_BAD_REQUEST,
                "INVALID_PHONE",
            )
        digits = f"91{digits}"
    elif not has_plus and len(digits) == 11 and digits.startswith("0") and re.match(r"^0[6-9]\d{9}$", digits):
        digits = f"91{digits[1:]}"
    elif digits.startswith("91") and len(digits) == 12 and not re.match(r"^91[6-9]\d{9}$", digits):
        raise WhatsAppProviderError(
            "Enter a valid Indian mobile number (+91 followed by 10 digits starting with 6-9).",
            status.HTTP_400_BAD_REQUEST,
            "INVALID_PHONE",
        )

    if len(digits) < 10 or len(digits) > 15:
        raise WhatsAppProviderError(
            "Enter a valid WhatsApp phone number with country code (e.g. +919876543210).",
            status.HTTP_400_BAD_REQUEST,
            "INVALID_PHONE",
        )

    e164 = f"+{digits}"
    return e164, mask_phone_number(e164)


def mask_phone_number(phone: Optional[str]) -> str:
    """Masks a phone number leaving only country prefix (if >10 digits) and last 4 digits."""
    if not phone:
        return "******"
    digits = re.sub(r"\D", "", str(phone).split("@")[0].split(":")[0])
    if len(digits) < 6:
        return "******"
    prefix = f"+{digits[:-10]} " if len(digits) > 10 else ""
    return f"{prefix}******{digits[-4:]}"


@dataclass
class WhatsAppStatusResult:
    provider: str
    enabled: bool
    experimental: bool
    sender_name: str
    session_id: str
    status: str
    connected: bool
    has_qr: bool
    has_saved_session: bool
    connected_phone_masked: Optional[str]
    last_connected_at: Optional[str]
    last_disconnected_at: Optional[str]
    reconnect_attempts: int
    last_error: Optional[str]


@dataclass
class WhatsAppQrResult:
    status: str
    connected: bool
    has_qr: bool
    qr_data_url: Optional[str]
    qr_generated_at: Optional[str]
    message: str


@dataclass
class WhatsAppSendResult:
    accepted: bool
    provider: str
    message_id: str
    ack_status: str
    recipient_masked: str
    timestamp: str


class WhatsAppProvider(ABC):
    """Provider-independent abstraction for merchant WhatsApp messaging and session control."""

    @abstractmethod
    def get_status(self) -> WhatsAppStatusResult:
        raise NotImplementedError

    @abstractmethod
    def connect(self) -> WhatsAppStatusResult:
        raise NotImplementedError

    @abstractmethod
    def get_qr(self) -> WhatsAppQrResult:
        raise NotImplementedError

    @abstractmethod
    def reconnect(self) -> WhatsAppStatusResult:
        raise NotImplementedError

    @abstractmethod
    def disconnect(self, logout: bool = False) -> WhatsAppStatusResult:
        raise NotImplementedError

    @abstractmethod
    def send_text(self, phone_e164: str, message: str) -> WhatsAppSendResult:
        raise NotImplementedError

    @abstractmethod
    def send_otp(self, phone_e164: str, otp: str, expiry_minutes: int) -> WhatsAppSendResult:
        raise NotImplementedError


class BerryProtocolWhatsAppProvider(WhatsAppProvider):
    """HTTP bridge adapter communicating with the local Node.js BerryProtocol sidecar."""

    def __init__(self) -> None:
        self.base_url = settings.whatsapp_service_url.rstrip("/")
        self.internal_key = settings.whatsapp_internal_api_key
        self.timeout = settings.whatsapp_request_timeout_seconds

    def _headers(self) -> dict:
        if not self.internal_key:
            raise WhatsAppProviderError(
                "WhatsApp internal bridge credentials are not configured.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "WHATSAPP_UNCONFIGURED",
            )
        return {"X-WhatsApp-Internal-Key": self.internal_key}

    def _request(self, method: str, path: str, json_payload: Optional[dict] = None) -> dict:
        url = f"{self.base_url}{path}"
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.request(method, url, headers=self._headers(), json=json_payload)
        except httpx.TimeoutException:
            raise WhatsAppProviderError(
                "WhatsApp gateway sidecar timed out. Verify the BerryProtocol service is responsive.",
                status.HTTP_504_GATEWAY_TIMEOUT,
                "WHATSAPP_TIMEOUT",
            )
        except httpx.RequestError:
            raise WhatsAppProviderError(
                "WhatsApp gateway sidecar is unavailable. Start the Node.js WhatsApp service or use Email OTP.",
                status.HTTP_503_SERVICE_UNAVAILABLE,
                "WHATSAPP_UNREACHABLE",
            )

        if resp.status_code >= 400:
            try:
                err_data = resp.json()
                detail = err_data.get("detail") or "WhatsApp service returned an error."
                code = err_data.get("error") or "WHATSAPP_ERROR"
            except ValueError:
                detail = "WhatsApp service returned an unexpected error."
                code = "WHATSAPP_ERROR"
            mapped_status = resp.status_code if resp.status_code in (400, 401, 502, 503, 504) else status.HTTP_502_BAD_GATEWAY
            raise WhatsAppProviderError(detail, mapped_status, code)

        return resp.json()

    @staticmethod
    def _to_status_result(data: dict) -> WhatsAppStatusResult:
        return WhatsAppStatusResult(
            provider=data.get("provider", settings.whatsapp_provider),
            enabled=bool(data.get("enabled", False)),
            experimental=bool(data.get("experimental", True)),
            sender_name=data.get("senderName", settings.whatsapp_sender_name),
            session_id=data.get("sessionId", settings.whatsapp_session_id),
            status=data.get("status", "DISCONNECTED"),
            connected=bool(data.get("connected", False)),
            has_qr=bool(data.get("hasQr", False)),
            has_saved_session=bool(data.get("hasSavedSession", False)),
            connected_phone_masked=data.get("connectedPhoneMasked"),
            last_connected_at=data.get("lastConnectedAt"),
            last_disconnected_at=data.get("lastDisconnectedAt"),
            reconnect_attempts=int(data.get("reconnectAttempts", 0)),
            last_error=data.get("lastError"),
        )

    def get_status(self) -> WhatsAppStatusResult:
        return self._to_status_result(self._request("GET", "/internal/status"))

    def connect(self) -> WhatsAppStatusResult:
        return self._to_status_result(self._request("POST", "/internal/connect"))

    def get_qr(self) -> WhatsAppQrResult:
        data = self._request("GET", "/internal/qr")
        return WhatsAppQrResult(
            status=data.get("status", "DISCONNECTED"),
            connected=bool(data.get("connected", False)),
            has_qr=bool(data.get("hasQr", False)),
            qr_data_url=data.get("qrDataUrl"),
            qr_generated_at=data.get("qrGeneratedAt"),
            message=data.get("message", ""),
        )

    def reconnect(self) -> WhatsAppStatusResult:
        return self._to_status_result(self._request("POST", "/internal/reconnect"))

    def disconnect(self, logout: bool = False) -> WhatsAppStatusResult:
        return self._to_status_result(self._request("POST", "/internal/disconnect", {"logout": logout}))

    def send_text(self, phone_e164: str, message: str) -> WhatsAppSendResult:
        data = self._request("POST", "/internal/send-text", {"phone": phone_e164, "message": message})
        if not data.get("accepted") or not data.get("messageId"):
            raise WhatsAppProviderError(
                "WhatsApp provider did not acknowledge message delivery.",
                status.HTTP_502_BAD_GATEWAY,
                "WHATSAPP_NO_ACK",
            )
        return WhatsAppSendResult(
            accepted=True,
            provider=data.get("provider", settings.whatsapp_provider),
            message_id=data["messageId"],
            ack_status=data.get("ackStatus", "sent"),
            recipient_masked=data.get("recipientMasked", mask_phone_number(phone_e164)),
            timestamp=data.get("timestamp", ""),
        )

    def send_otp(self, phone_e164: str, otp: str, expiry_minutes: int) -> WhatsAppSendResult:
        data = self._request(
            "POST",
            "/internal/send-otp",
            {"phone": phone_e164, "otp": otp, "expiryMinutes": expiry_minutes},
        )
        if not data.get("accepted") or not data.get("messageId"):
            raise WhatsAppProviderError(
                "WhatsApp provider did not acknowledge OTP message submission.",
                status.HTTP_502_BAD_GATEWAY,
                "WHATSAPP_NO_ACK",
            )
        return WhatsAppSendResult(
            accepted=True,
            provider=data.get("provider", settings.whatsapp_provider),
            message_id=data["messageId"],
            ack_status=data.get("ackStatus", "sent"),
            recipient_masked=data.get("recipientMasked", mask_phone_number(phone_e164)),
            timestamp=data.get("timestamp", ""),
        )


_provider_override: Optional[WhatsAppProvider] = None


def set_whatsapp_provider(provider: Optional[WhatsAppProvider]) -> None:
    """Allows tests to inject a mock WhatsAppProvider cleanly."""
    global _provider_override
    _provider_override = provider


def get_whatsapp_provider() -> WhatsAppProvider:
    if _provider_override is not None:
        return _provider_override
    return BerryProtocolWhatsAppProvider()
