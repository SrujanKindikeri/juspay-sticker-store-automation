import hmac
from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status
from app.core.config import settings
from app.schemas.whatsapp_verification import (
    WhatsAppAdminQrResponse,
    WhatsAppAdminStatusResponse,
    WhatsAppDisconnectRequest,
    WhatsAppSendTestRequest,
    WhatsAppSendTestResponse,
)
from app.services.whatsapp_provider import get_whatsapp_provider, normalize_whatsapp_phone

router = APIRouter(prefix="/admin/whatsapp", tags=["Merchant WhatsApp Admin"])


def require_whatsapp_admin(x_admin_key: Optional[str] = Header(None, alias="X-Admin-Key")) -> None:
    """Strictly validates merchant administrator key in constant time."""
    expected_key = settings.whatsapp_admin_key.strip()
    if not expected_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Merchant WhatsApp admin authentication key is not configured.",
        )
    if not x_admin_key or not hmac.compare_digest(x_admin_key.strip(), expected_key):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Administrator authentication required.",
        )


def _map_status(result) -> WhatsAppAdminStatusResponse:
    return WhatsAppAdminStatusResponse(
        provider=result.provider,
        enabled=result.enabled,
        experimental=result.experimental,
        sender_name=result.sender_name,
        session_id=result.session_id,
        status=result.status,
        connected=result.connected,
        has_qr=result.has_qr,
        has_saved_session=result.has_saved_session,
        connected_phone_masked=result.connected_phone_masked,
        last_connected_at=result.last_connected_at,
        last_disconnected_at=result.last_disconnected_at,
        reconnect_attempts=result.reconnect_attempts,
        last_error=result.last_error,
    )


@router.get(
    "/status",
    response_model=WhatsAppAdminStatusResponse,
    dependencies=[Depends(require_whatsapp_admin)],
    summary="Get Merchant WhatsApp Connection Status",
)
def get_whatsapp_admin_status() -> WhatsAppAdminStatusResponse:
    provider = get_whatsapp_provider()
    return _map_status(provider.get_status())


@router.post(
    "/connect",
    response_model=WhatsAppAdminStatusResponse,
    dependencies=[Depends(require_whatsapp_admin)],
    summary="Connect Merchant WhatsApp Session",
)
def connect_whatsapp_admin() -> WhatsAppAdminStatusResponse:
    provider = get_whatsapp_provider()
    return _map_status(provider.connect())


@router.get(
    "/qr",
    response_model=WhatsAppAdminQrResponse,
    dependencies=[Depends(require_whatsapp_admin)],
    summary="Get Merchant WhatsApp Pairing QR Code",
)
def get_whatsapp_admin_qr() -> WhatsAppAdminQrResponse:
    provider = get_whatsapp_provider()
    qr = provider.get_qr()
    return WhatsAppAdminQrResponse(
        status=qr.status,
        connected=qr.connected,
        has_qr=qr.has_qr,
        qr_data_url=qr.qr_data_url,
        qr_generated_at=qr.qr_generated_at,
        message=qr.message,
    )


@router.post(
    "/reconnect",
    response_model=WhatsAppAdminStatusResponse,
    dependencies=[Depends(require_whatsapp_admin)],
    summary="Reconnect Merchant WhatsApp Session",
)
def reconnect_whatsapp_admin() -> WhatsAppAdminStatusResponse:
    provider = get_whatsapp_provider()
    return _map_status(provider.reconnect())


@router.post(
    "/disconnect",
    response_model=WhatsAppAdminStatusResponse,
    dependencies=[Depends(require_whatsapp_admin)],
    summary="Disconnect Merchant WhatsApp Session",
)
def disconnect_whatsapp_admin(payload: Optional[WhatsAppDisconnectRequest] = None) -> WhatsAppAdminStatusResponse:
    provider = get_whatsapp_provider()
    logout = bool(payload.logout) if payload else False
    return _map_status(provider.disconnect(logout=logout))


@router.post(
    "/send-test",
    response_model=WhatsAppSendTestResponse,
    dependencies=[Depends(require_whatsapp_admin)],
    summary="Send Authorized Test WhatsApp Message",
)
def send_whatsapp_admin_test(request: WhatsAppSendTestRequest) -> WhatsAppSendTestResponse:
    phone_e164, _ = normalize_whatsapp_phone(request.phone)
    provider = get_whatsapp_provider()
    res = provider.send_text(phone_e164=phone_e164, message=request.message)
    return WhatsAppSendTestResponse(
        accepted=res.accepted,
        provider=res.provider,
        message_id=res.message_id,
        ack_status=res.ack_status,
        recipient_masked=res.recipient_masked,
        timestamp=res.timestamp,
    )
