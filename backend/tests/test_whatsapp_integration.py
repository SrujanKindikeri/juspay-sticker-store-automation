from datetime import datetime, timedelta
import logging
from typing import List, Tuple
import uuid
import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.database.session import SessionLocal
from app.models.whatsapp_verification import WhatsAppVerificationSession
from app.services.whatsapp_provider import (
    WhatsAppProvider,
    WhatsAppProviderError,
    WhatsAppQrResult,
    WhatsAppSendResult,
    WhatsAppStatusResult,
    mask_phone_number,
    set_whatsapp_provider,
)


class MockWhatsAppProvider(WhatsAppProvider):
    """In-memory mock provider guaranteeing zero real WhatsApp network traffic during automated tests."""

    def __init__(self, connected: bool = True, ack_status: str = "sent"):
        self.connected = connected
        self.ack_status = ack_status
        self.sent_otps: List[Tuple[str, str, int]] = []
        self.sent_texts: List[Tuple[str, str]] = []
        self.qr_data_url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
        self.counter = 0

    def get_status(self) -> WhatsAppStatusResult:
        return WhatsAppStatusResult(
            provider="berryprotocol",
            enabled=True,
            experimental=True,
            sender_name="Stickora Store",
            session_id="stickora_test_session",
            status="CONNECTED" if self.connected else "DISCONNECTED",
            connected=self.connected,
            has_qr=not self.connected,
            has_saved_session=True,
            connected_phone_masked="+91 ******0001" if self.connected else None,
            last_connected_at="2026-11-25T10:00:00Z" if self.connected else None,
            last_disconnected_at=None if self.connected else "2026-11-25T10:05:00Z",
            reconnect_attempts=0,
            last_error=None,
        )

    def connect(self) -> WhatsAppStatusResult:
        return WhatsAppStatusResult(
            provider="berryprotocol",
            enabled=True,
            experimental=True,
            sender_name="Stickora Store",
            session_id="stickora_test_session",
            status="QR_READY" if not self.connected else "CONNECTED",
            connected=self.connected,
            has_qr=not self.connected,
            has_saved_session=False,
            connected_phone_masked="+91 ******0001" if self.connected else None,
            last_connected_at=None,
            last_disconnected_at=None,
            reconnect_attempts=0,
            last_error=None,
        )

    def get_qr(self) -> WhatsAppQrResult:
        return WhatsAppQrResult(
            status="CONNECTED" if self.connected else "QR_READY",
            connected=self.connected,
            has_qr=not self.connected,
            qr_data_url=None if self.connected else self.qr_data_url,
            qr_generated_at=None if self.connected else "2026-11-25T10:00:00Z",
            message="Connected" if self.connected else "Scan QR code",
        )

    def reconnect(self) -> WhatsAppStatusResult:
        self.connected = True
        return self.get_status()

    def disconnect(self, logout: bool = False) -> WhatsAppStatusResult:
        self.connected = False
        return self.get_status()

    def send_text(self, phone_e164: str, message: str) -> WhatsAppSendResult:
        if not self.connected:
            raise WhatsAppProviderError("WhatsApp session is disconnected.", 503, "WHATSAPP_DISCONNECTED")
        self.counter += 1
        self.sent_texts.append((phone_e164, message))
        return WhatsAppSendResult(
            accepted=True,
            provider="berryprotocol",
            message_id=f"MOCK_TXT_{self.counter}",
            ack_status=self.ack_status,
            recipient_masked=mask_phone_number(phone_e164),
            timestamp="2026-11-25T10:00:00Z",
        )

    def send_otp(self, phone_e164: str, otp: str, expiry_minutes: int) -> WhatsAppSendResult:
        if not self.connected:
            raise WhatsAppProviderError("Merchant WhatsApp session is disconnected.", 503, "WHATSAPP_DISCONNECTED")
        self.counter += 1
        self.sent_otps.append((phone_e164, otp, expiry_minutes))
        return WhatsAppSendResult(
            accepted=True,
            provider="berryprotocol",
            message_id=f"MOCK_OTP_{self.counter}",
            ack_status=self.ack_status,
            recipient_masked=mask_phone_number(phone_e164),
            timestamp="2026-11-25T10:00:00Z",
        )


def _random_mobile() -> str:
    return f"+919{uuid.uuid4().int % 900000000 + 100000000}"


@pytest.fixture
def whatsapp_test_env(monkeypatch):
    mock_provider = MockWhatsAppProvider(connected=True)
    set_whatsapp_provider(mock_provider)
    monkeypatch.setattr(settings, "whatsapp_enabled", True)
    monkeypatch.setattr(settings, "whatsapp_dispatch_enabled", True)
    monkeypatch.setattr(settings, "whatsapp_admin_key", "unit_test_admin_secret_key")
    yield mock_provider
    set_whatsapp_provider(None)


def test_whatsapp_admin_endpoints_require_authentication(client: TestClient, whatsapp_test_env: MockWhatsAppProvider):
    for method, url, payload in [
        ("GET", "/api/v1/admin/whatsapp/status", None),
        ("POST", "/api/v1/admin/whatsapp/connect", None),
        ("GET", "/api/v1/admin/whatsapp/qr", None),
        ("POST", "/api/v1/admin/whatsapp/reconnect", None),
        ("POST", "/api/v1/admin/whatsapp/disconnect", {"logout": False}),
        ("POST", "/api/v1/admin/whatsapp/send-test", {"phone": "9876543210", "message": "hello"}),
    ]:
        res = client.request(method, url, json=payload)
        assert res.status_code == 401
        wrong_res = client.request(method, url, json=payload, headers={"X-Admin-Key": "wrong-key"})
        assert wrong_res.status_code == 401

    headers = {"X-Admin-Key": "unit_test_admin_secret_key"}
    whatsapp_test_env.connected = False

    connect_res = client.post("/api/v1/admin/whatsapp/connect", headers=headers)
    assert connect_res.status_code == 200
    assert connect_res.json()["status"] == "QR_READY"

    qr_res = client.get("/api/v1/admin/whatsapp/qr", headers=headers)
    assert qr_res.status_code == 200
    assert qr_res.json()["has_qr"] is True
    assert qr_res.json()["qr_data_url"].startswith("data:image/png;base64,")

    reconnect_res = client.post("/api/v1/admin/whatsapp/reconnect", headers=headers)
    assert reconnect_res.status_code == 200
    assert reconnect_res.json()["connected"] is True

    test_msg_res = client.post(
        "/api/v1/admin/whatsapp/send-test",
        headers=headers,
        json={"phone": "9876543210", "message": "Stickora admin check"},
    )
    assert test_msg_res.status_code == 200
    assert test_msg_res.json()["accepted"] is True
    assert test_msg_res.json()["message_id"] == "MOCK_TXT_1"

    disc_res = client.post("/api/v1/admin/whatsapp/disconnect", headers=headers, json={"logout": False})
    assert disc_res.status_code == 200
    assert disc_res.json()["connected"] is False


def test_whatsapp_availability_hides_qr_and_sensitive_fields(client: TestClient, whatsapp_test_env: MockWhatsAppProvider):
    res = client.get("/api/v1/verification/whatsapp/availability")
    assert res.status_code == 200
    data = res.json()
    assert set(data.keys()) == {"enabled", "experimental", "provider", "connected", "available", "message"}
    assert data["available"] is True

    whatsapp_test_env.connected = False
    res2 = client.get("/api/v1/verification/whatsapp/availability")
    assert res2.status_code == 200
    assert res2.json()["available"] is False


def test_whatsapp_send_otp_fails_when_disconnected_or_disabled(client: TestClient, monkeypatch, whatsapp_test_env: MockWhatsAppProvider):
    mobile = _random_mobile()
    whatsapp_test_env.connected = False
    res = client.post("/api/v1/verification/whatsapp/send-otp", json={"phone": mobile})
    assert res.status_code == 503

    whatsapp_test_env.connected = True
    monkeypatch.setattr(settings, "whatsapp_dispatch_enabled", False)
    res_disabled = client.post("/api/v1/verification/whatsapp/send-otp", json={"phone": mobile})
    assert res_disabled.status_code == 503


def test_whatsapp_invalid_phone_rejected(client: TestClient, whatsapp_test_env: MockWhatsAppProvider):
    for bad in ("12345", "1234567890", "+911234567890", "not-a-phone"):
        res = client.post("/api/v1/verification/whatsapp/send-otp", json={"phone": bad})
        assert res.status_code in (400, 422), f"Expected rejection for {bad}, got {res.status_code}"

    # Valid Indian 10-digit mobile normalizes cleanly to +91 E.164
    res_ok = client.post("/api/v1/verification/whatsapp/send-otp", json={"phone": "9640404455"})
    assert res_ok.status_code == 200
    assert whatsapp_test_env.sent_otps[-1][0] == "+919640404455"
    assert res_ok.json()["phone_masked"] == "+91 ******4455"


def test_whatsapp_otp_lifecycle_cooldown_attempts_expiry_and_no_otp_logging(
    client: TestClient, whatsapp_test_env: MockWhatsAppProvider, caplog
):
    caplog.set_level(logging.DEBUG)
    mobile = _random_mobile()

    # 1. Send OTP
    send_res = client.post("/api/v1/verification/whatsapp/send-otp", json={"phone": mobile})
    assert send_res.status_code == 200
    send_data = send_res.json()
    session_id = send_data["session_id"]
    assert "simulated_otp" not in send_data
    assert len(whatsapp_test_env.sent_otps) == 1
    first_otp = whatsapp_test_env.sent_otps[0][1]

    # Never log plaintext OTP
    assert not any(first_otp in rec.message for rec in caplog.records)

    # 2. Immediate resend blocked by 30-second cooldown
    cooldown_res = client.post(
        "/api/v1/verification/whatsapp/send-otp",
        json={"phone": mobile, "session_id": session_id},
    )
    assert cooldown_res.status_code == 429

    # 3. Simulate cooldown elapsed -> resend invalidates first OTP
    with SessionLocal() as db:
        sess = db.query(WhatsAppVerificationSession).filter(WhatsAppVerificationSession.session_id == session_id).first()
        sess.last_otp_sent_at = datetime.utcnow() - timedelta(seconds=35)
        db.commit()

    resend_res = client.post(
        "/api/v1/verification/whatsapp/send-otp",
        json={"phone": mobile, "session_id": session_id},
    )
    assert resend_res.status_code == 200
    second_otp = whatsapp_test_env.sent_otps[1][1]

    if first_otp != second_otp:
        old_try = client.post(
            "/api/v1/verification/whatsapp/verify-otp",
            json={"session_id": session_id, "phone": mobile, "otp": first_otp},
        )
        assert old_try.status_code == 400

    # 4. Lock out after 3 incorrect attempts
    wrong_otp = "000000" if second_otp != "000000" else "999999"
    for _ in range(3):
        bad = client.post(
            "/api/v1/verification/whatsapp/verify-otp",
            json={"session_id": session_id, "phone": mobile, "otp": wrong_otp},
        )
        assert bad.status_code == 400

    locked = client.post(
        "/api/v1/verification/whatsapp/verify-otp",
        json={"session_id": session_id, "phone": mobile, "otp": second_otp},
    )
    assert locked.status_code == 400

    # 5. Expiry check on a fresh session
    fresh_res = client.post("/api/v1/verification/whatsapp/send-otp", json={"phone": mobile})
    assert fresh_res.status_code == 200
    fresh_sid = fresh_res.json()["session_id"]
    fresh_otp = whatsapp_test_env.sent_otps[-1][1]

    with SessionLocal() as db:
        sess = db.query(WhatsAppVerificationSession).filter(WhatsAppVerificationSession.session_id == fresh_sid).first()
        sess.otp_expires_at = datetime.utcnow() - timedelta(seconds=5)
        db.commit()

    expired = client.post(
        "/api/v1/verification/whatsapp/verify-otp",
        json={"session_id": fresh_sid, "phone": mobile, "otp": fresh_otp},
    )
    assert expired.status_code == 400
    assert not any(fresh_otp in rec.message for rec in caplog.records)


def test_whatsapp_order_enforcement_and_full_payment_flow(
    client: TestClient, whatsapp_test_env: MockWhatsAppProvider
):
    mobile = _random_mobile()
    base_delivery = {
        "full_name": "WhatsApp Verified Buyer",
        "mobile_number": mobile,
        "email": f"wa.{uuid.uuid4().hex[:8]}@example.com",
        "address_line": "100 Indiranagar 12th Main",
        "city": "Bengaluru",
        "state": "Karnataka",
        "pincode": "560038",
    }

    # Unverified WhatsApp checkout order must be rejected
    unverified_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": base_delivery,
            "contact_verification_channel": "whatsapp",
        },
    )
    assert unverified_res.status_code == 403

    # Verify WhatsApp OTP cleanly
    send_res = client.post("/api/v1/verification/whatsapp/send-otp", json={"phone": mobile})
    assert send_res.status_code == 200
    sid = send_res.json()["session_id"]
    otp = whatsapp_test_env.sent_otps[-1][1]

    verify_res = client.post(
        "/api/v1/verification/whatsapp/verify-otp",
        json={"session_id": sid, "phone": mobile, "otp": otp},
    )
    assert verify_res.status_code == 200
    wa_token = verify_res.json()["verification_token"]

    # Mismatched phone number rejected
    bad_phone_delivery = {**base_delivery, "mobile_number": "+919111122222"}
    mismatch_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": bad_phone_delivery,
            "contact_verification_channel": "whatsapp",
            "whatsapp_verification_session_id": sid,
            "whatsapp_verification_token": wa_token,
        },
    )
    assert mismatch_res.status_code == 403

    # Valid verified order succeeds
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": base_delivery,
            "contact_verification_channel": "whatsapp",
            "whatsapp_verification_session_id": sid,
            "whatsapp_verification_token": wa_token,
        },
    )
    assert order_res.status_code == 201
    order_data = order_res.json()
    assert order_data["status"] == "PENDING_PAYMENT"
    assert order_data["contact_verification_channel"] == "whatsapp"
    assert order_data["whatsapp_verified"] is True
    assert order_data["email_verified"] is False

    # Replay of consumed token rejected
    replay_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": base_delivery,
            "contact_verification_channel": "whatsapp",
            "whatsapp_verification_session_id": sid,
            "whatsapp_verification_token": wa_token,
        },
    )
    assert replay_res.status_code == 409

    # Complete existing Payment OTP workflow untouched
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_data["order_id"],
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "UPI",
            "customer_email": base_delivery["email"],
            "upi_details": {"upi_id": "buyer@okaxis", "app_name": "gpay"},
        },
    )
    assert init_res.status_code == 201
    txn_id = init_res.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    assert otp_res.status_code == 200
    payment_otp = otp_res.json()["simulated_otp"]

    verify_pay = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": payment_otp})
    assert verify_pay.status_code == 200

    proc = client.post(
        f"/api/v1/payments/{txn_id}/process",
        json={"outcome": "SUCCESS"},
    )
    assert proc.status_code == 200
    assert proc.json()["status"] == "SUCCESS"

    paid_order = client.get(
        f"/api/v1/store/orders/{order_data['order_id']}",
        headers={"X-Order-Token": order_data["order_token"]},
    )
    assert paid_order.status_code == 200
    assert paid_order.json()["status"] == "PAID"
