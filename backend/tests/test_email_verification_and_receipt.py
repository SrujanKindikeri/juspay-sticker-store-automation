import io
import uuid
import httpx
from unittest.mock import patch
from fastapi.testclient import TestClient
from pypdf import PdfReader
from app.core.config import settings
from app.database.session import SessionLocal
from app.models.email_verification import EmailVerificationSession
from tests.conftest import verify_test_email

MAILPIT_API = "http://localhost:8025/api/v1"


def _fetch_mailpit_messages(query: str) -> list:
    res = httpx.get(f"{MAILPIT_API}/search?query={query}", timeout=5.0)
    res.raise_for_status()
    return res.json().get("messages", [])


def _fetch_mailpit_message_detail(msg_id: str) -> dict:
    res = httpx.get(f"{MAILPIT_API}/message/{msg_id}", timeout=5.0)
    res.raise_for_status()
    return res.json()


def _create_verified_order_and_pay(
    client: TestClient,
    email: str,
    outcome: str = "SUCCESS",
) -> tuple[dict, str]:
    proof = verify_test_email(client, email)
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": {
                "full_name": "Receipt Test User",
                "mobile_number": "9876543210",
                "email": email,
                "address_line": "21 Residency Road",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
            **proof,
        },
    )
    assert order_res.status_code == 201
    order_data = order_res.json()

    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_data["order_id"],
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "CARD",
            "customer_email": email,
            "card_details": {
                "card_number": "4111 2222 3333 4444",
                "expiry": "12/28",
                "cvv": "123",
                "card_holder": "RECEIPT USER",
            },
        },
    )
    assert init_res.status_code == 201
    txn_id = init_res.json()["transaction_id"]

    otp = client.post(f"/api/v1/payments/{txn_id}/send-otp").json()["simulated_otp"]
    client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})
    proc_res = client.post(f"/api/v1/payments/{txn_id}/process", json={"outcome": outcome})
    assert proc_res.status_code == 200
    return order_data, txn_id


def test_1_valid_email_otp_and_hash_storage(client: TestClient):
    """Valid email OTP sends via SMTP to Mailpit, stores only HMAC hash, and verifies email."""
    unique_email = f"valid-{uuid.uuid4().hex[:8]}@stickora-test.demo"

    send_res = client.post("/api/v1/email-verification/send-otp", json={"email": unique_email})
    assert send_res.status_code == 200
    data = send_res.json()
    session_id = data["session_id"]
    otp = data["simulated_otp"]
    assert len(otp) == 6 and otp.isdigit()

    with SessionLocal() as db:
        rec = db.query(EmailVerificationSession).filter_by(session_id=session_id).first()
        assert rec is not None
        assert rec.otp_hash != otp
        assert len(rec.otp_hash) == 64
        assert rec.status == "PENDING"

    msgs = _fetch_mailpit_messages(unique_email)
    assert len(msgs) >= 1
    detail = _fetch_mailpit_message_detail(msgs[0]["ID"])
    assert otp in detail.get("Text", "")

    ver_res = client.post(
        "/api/v1/email-verification/verify-otp",
        json={"session_id": session_id, "email": unique_email, "otp": otp},
    )
    assert ver_res.status_code == 200
    ver_data = ver_res.json()
    assert ver_data["verified"] is True
    assert ver_data["status"] == "VERIFIED"
    assert ver_data["verification_token"]


def test_2_incorrect_email_otp_decrements_attempts(client: TestClient):
    """Wrong email OTP is rejected and decrements remaining attempts."""
    unique_email = f"wrong-{uuid.uuid4().hex[:8]}@stickora-test.demo"
    send_data = client.post("/api/v1/email-verification/send-otp", json={"email": unique_email}).json()
    session_id = send_data["session_id"]
    wrong_otp = "000000" if send_data["simulated_otp"] != "000000" else "999999"

    res = client.post(
        "/api/v1/email-verification/verify-otp",
        json={"session_id": session_id, "email": unique_email, "otp": wrong_otp},
    )
    assert res.status_code == 400
    assert "2 attempt(s) remaining" in res.json()["detail"]

    status_res = client.get(f"/api/v1/email-verification/status/{session_id}").json()
    assert status_res["attempts_remaining"] == 2
    assert status_res["verified"] is False


def test_3_expired_email_otp_rejected(client: TestClient):
    """Expired email OTP (> 5 minutes) is rejected and marks session EXPIRED."""
    unique_email = f"expired-{uuid.uuid4().hex[:8]}@stickora-test.demo"
    send_data = client.post("/api/v1/email-verification/send-otp", json={"email": unique_email}).json()

    res = client.post(
        "/api/v1/email-verification/verify-otp",
        json={
            "session_id": send_data["session_id"],
            "email": unique_email,
            "otp": send_data["simulated_otp"],
        },
        headers={"X-Test-Clock-Offset": "360"},
    )
    assert res.status_code == 400
    assert "expired" in res.json()["detail"].lower()

    status_res = client.get(f"/api/v1/email-verification/status/{send_data['session_id']}").json()
    assert status_res["status"] == "EXPIRED"
    assert status_res["verified"] is False


def test_4_resend_cooldown_previous_invalidation_and_max_resends(client: TestClient):
    """Enforces 30s resend cooldown, invalidates prior OTP on resend, and enforces max 3 resends."""
    unique_email = f"resend-{uuid.uuid4().hex[:8]}@stickora-test.demo"
    first = client.post("/api/v1/email-verification/send-otp", json={"email": unique_email}).json()
    session_id = first["session_id"]
    first_otp = first["simulated_otp"]

    too_fast = client.post(
        "/api/v1/email-verification/send-otp",
        json={"email": unique_email, "session_id": session_id},
    )
    assert too_fast.status_code == 429

    r1 = client.post(
        "/api/v1/email-verification/send-otp",
        json={"email": unique_email, "session_id": session_id},
        headers={"X-Test-Clock-Offset": "35"},
    )
    assert r1.status_code == 200
    second_otp = r1.json()["simulated_otp"]

    if first_otp != second_otp:
        old_attempt = client.post(
            "/api/v1/email-verification/verify-otp",
            json={"session_id": session_id, "email": unique_email, "otp": first_otp},
            headers={"X-Test-Clock-Offset": "35"},
        )
        assert old_attempt.status_code == 400

    for offset in ("70", "105"):
        res = client.post(
            "/api/v1/email-verification/send-otp",
            json={"email": unique_email, "session_id": session_id},
            headers={"X-Test-Clock-Offset": offset},
        )
        assert res.status_code == 200

    r4 = client.post(
        "/api/v1/email-verification/send-otp",
        json={"email": unique_email, "session_id": session_id},
        headers={"X-Test-Clock-Offset": "140"},
    )
    assert r4.status_code == 429
    assert "Maximum" in r4.json()["detail"]


def test_5_max_attempts_and_cross_email_blocked(client: TestClient):
    """3 wrong OTP attempts lock session to FAILED; cross-email verification returns HTTP 403."""
    email_a = f"alice-{uuid.uuid4().hex[:6]}@stickora-test.demo"
    email_b = f"bob-{uuid.uuid4().hex[:6]}@stickora-test.demo"
    send_data = client.post("/api/v1/email-verification/send-otp", json={"email": email_a}).json()
    session_id = send_data["session_id"]

    cross = client.post(
        "/api/v1/email-verification/verify-otp",
        json={"session_id": session_id, "email": email_b, "otp": send_data["simulated_otp"]},
    )
    assert cross.status_code == 403

    wrong_otp = "000000" if send_data["simulated_otp"] != "000000" else "999999"
    for _ in range(2):
        assert (
            client.post(
                "/api/v1/email-verification/verify-otp",
                json={"session_id": session_id, "email": email_a, "otp": wrong_otp},
            ).status_code
            == 400
        )

    third = client.post(
        "/api/v1/email-verification/verify-otp",
        json={"session_id": session_id, "email": email_a, "otp": wrong_otp},
    )
    assert third.status_code == 400
    assert "Maximum incorrect" in third.json()["detail"]
    assert client.get(f"/api/v1/email-verification/status/{session_id}").json()["status"] == "FAILED"


def test_6_order_creation_with_unverified_email_rejected(client: TestClient):
    """Backend strictly rejects order creation when email is unverified."""
    res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": {
                "full_name": "Unverified User",
                "mobile_number": "9876543210",
                "email": "unverified@stickora-test.demo",
                "address_line": "10 Bypass Street",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
        },
    )
    assert res.status_code == 400
    assert "verified" in res.json()["detail"].lower()


def test_7_verified_email_order_success_and_production_hides_otp(client: TestClient, monkeypatch):
    """Verified email creates PENDING_PAYMENT order; production hides simulated_otp."""
    unique_email = f"prodhide-{uuid.uuid4().hex[:8]}@stickora-test.demo"
    proof = verify_test_email(client, unique_email)

    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": {
                "full_name": "Verified Buyer",
                "mobile_number": "9876543210",
                "email": unique_email,
                "address_line": "22 Verified Way",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
            **proof,
        },
    )
    assert order_res.status_code == 201
    data = order_res.json()
    assert data["email_verified"] is True
    assert data["email_verified_at"] is not None
    assert data["status"] == "PENDING_PAYMENT"

    monkeypatch.setattr(settings, "environment", "production")
    prod_send = client.post(
        "/api/v1/email-verification/send-otp",
        json={"email": f"prod-{uuid.uuid4().hex[:6]}@stickora-test.demo"},
    )
    assert prod_send.status_code == 200
    assert prod_send.json()["simulated_otp"] is None


def test_8_and_11_successful_payment_sends_confirmation_email_and_valid_pdf(client: TestClient):
    """
    Verified successful payment automatically sends HTML confirmation email + authoritative PDF receipt,
    and PDF contains accurate order and payment details.
    """
    unique_email = f"receipt-{uuid.uuid4().hex[:8]}@stickora-test.demo"
    order_data, txn_id = _create_verified_order_and_pay(client, unique_email, outcome="SUCCESS")
    order_id = order_data["order_id"]

    fetched = client.get(
        f"/api/v1/store/orders/{order_id}",
        headers={"X-Order-Token": order_data["order_token"]},
    ).json()
    assert fetched["status"] == "PAID"
    assert fetched["receipt_email_status"] == "SENT"
    assert fetched["receipt_email_sent_at"] is not None
    assert fetched["receipt_email_attempts"] == 1

    msgs = _fetch_mailpit_messages(order_id)
    assert len(msgs) == 1
    assert msgs[0]["Subject"] == "Your Juspay Sticker Store Order Confirmation"

    detail = _fetch_mailpit_message_detail(msgs[0]["ID"])
    html_content = detail.get("HTML", "")
    assert order_id in html_content
    assert txn_id in html_content
    assert "Cyberpunk Neon Cat" in html_content
    assert "PAID" in html_content
    assert "SUCCESS" in html_content

    attachments = detail.get("Attachments", [])
    assert len(attachments) == 1
    assert attachments[0]["FileName"] == f"Stickora-Receipt-{order_id}.pdf"

    att_res = httpx.get(
        f"{MAILPIT_API}/message/{msgs[0]['ID']}/part/{attachments[0]['PartID']}",
        timeout=5.0,
    )
    assert att_res.status_code == 200
    assert att_res.content.startswith(b"%PDF-")

    reader = PdfReader(io.BytesIO(att_res.content))
    pdf_text = "\n".join(page.extract_text() or "" for page in reader.pages)
    assert "Receipt Test User" in pdf_text
    assert unique_email in pdf_text
    assert order_id in pdf_text
    assert txn_id in pdf_text
    assert "Cyberpunk Neon Cat" in pdf_text
    assert "149.00" in pdf_text
    assert "SUCCESS" in pdf_text
    assert "PAID" in pdf_text
    assert "560001" in pdf_text


def test_9_failed_payment_does_not_send_receipt(client: TestClient):
    """Declined/failed payment does not send a confirmation receipt email."""
    unique_email = f"failmail-{uuid.uuid4().hex[:8]}@stickora-test.demo"
    order_data, _ = _create_verified_order_and_pay(client, unique_email, outcome="DECLINED")
    order_id = order_data["order_id"]

    fetched = client.get(
        f"/api/v1/store/orders/{order_id}",
        headers={"X-Order-Token": order_data["order_token"]},
    ).json()
    assert fetched["status"] == "PAYMENT_FAILED"
    assert fetched["receipt_email_status"] == "NOT_SENT"
    assert _fetch_mailpit_messages(order_id) == []


def test_10_duplicate_payment_callback_does_not_send_duplicate_receipt(client: TestClient):
    """Repeated /process call (409) and retry-receipt never send a duplicate confirmation email."""
    unique_email = f"nodup-{uuid.uuid4().hex[:8]}@stickora-test.demo"
    order_data, txn_id = _create_verified_order_and_pay(client, unique_email, outcome="SUCCESS")
    order_id = order_data["order_id"]

    dup_proc = client.post(f"/api/v1/payments/{txn_id}/process", json={"outcome": "SUCCESS"})
    assert dup_proc.status_code == 409

    retry_res = client.post(
        f"/api/v1/store/orders/{order_id}/retry-receipt",
        headers={"X-Order-Token": order_data["order_token"]},
    )
    assert retry_res.status_code == 200
    assert retry_res.json()["receipt_email_attempts"] == 1
    assert len(_fetch_mailpit_messages(order_id)) == 1


def test_12_and_13_email_failure_does_not_rollback_paid_and_retry_succeeds(client: TestClient):
    """
    SMTP failure during receipt sending leaves payment SUCCESS and order PAID, marks receipt FAILED,
    and subsequent /retry-receipt succeeds cleanly when SMTP recovers.
    """
    unique_email = f"retryok-{uuid.uuid4().hex[:8]}@stickora-test.demo"
    proof = verify_test_email(client, unique_email)
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": {
                "full_name": "Retry Email User",
                "mobile_number": "9876543210",
                "email": unique_email,
                "address_line": "88 Recovery Road",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
            **proof,
        },
    )
    assert order_res.status_code == 201
    order_data = order_res.json()
    order_id = order_data["order_id"]
    order_token = order_data["order_token"]

    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "CARD",
            "customer_email": unique_email,
            "card_details": {
                "card_number": "4111 2222 3333 4444",
                "expiry": "12/28",
                "cvv": "123",
                "card_holder": "RETRY EMAIL",
            },
        },
    ).json()
    txn_id = init_res["transaction_id"]
    otp = client.post(f"/api/v1/payments/{txn_id}/send-otp").json()["simulated_otp"]
    client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})

    with patch("app.services.email_service._send_smtp_email", side_effect=RuntimeError("SMTP timeout")):
        proc_res = client.post(f"/api/v1/payments/{txn_id}/process", json={"outcome": "SUCCESS"})

    assert proc_res.status_code == 200
    assert proc_res.json()["status"] == "SUCCESS"

    order_after_fail = client.get(
        f"/api/v1/store/orders/{order_id}",
        headers={"X-Order-Token": order_token},
    ).json()
    assert order_after_fail["status"] == "PAID"
    assert order_after_fail["receipt_email_status"] == "FAILED"
    assert order_after_fail["receipt_email_attempts"] == 1

    retry_res = client.post(
        f"/api/v1/store/orders/{order_id}/retry-receipt",
        headers={"X-Order-Token": order_token},
    )
    assert retry_res.status_code == 200
    retry_data = retry_res.json()
    assert retry_data["receipt_email_status"] == "SENT"
    assert retry_data["receipt_email_attempts"] == 2
    assert len(_fetch_mailpit_messages(order_id)) == 1
