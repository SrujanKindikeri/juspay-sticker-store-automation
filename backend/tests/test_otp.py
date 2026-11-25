import uuid
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.database.session import SessionLocal
from app.models.payment import PaymentTransaction
from app.core.config import settings
from app.services.otp_service import compute_otp_hmac, verify_otp_hmac


def create_pending_transaction(client: TestClient, order_id="DEMO-OTP-TEST") -> str:
    """Helper to initiate a pending payment and return transaction_id."""
    unique_order_id = f"{order_id}-{uuid.uuid4().hex[:6]}"
    payload = {
        "order_id": unique_order_id,
        "amount": 999.00,
        "currency": "INR",
        "payment_method": "UPI",
        "upi_details": {"upi_id": "tester@okaxis"},
    }
    res = client.post("/api/v1/payments/initiate", json=payload)
    assert res.status_code == 201
    return res.json()["transaction_id"]


def test_correct_otp_authenticates_but_does_not_complete_payment(client: TestClient):
    """
    Test that verifying a valid OTP marks the transaction as AUTHENTICATED,
    clears the OTP hash (preventing reuse), and does NOT mark status = SUCCESS.
    Subsequent call to /process transitions it: AUTHENTICATED -> PROCESSING -> SUCCESS.
    """
    txn_id = create_pending_transaction(client, "DEMO-LIFECYCLE-1")
    send_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    assert send_res.status_code == 200
    otp = send_res.json()["simulated_otp"]

    # 1. Verify OTP
    verify_res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": otp},
    )
    assert verify_res.status_code == 200
    data = verify_res.json()

    # Must be AUTHENTICATED, not SUCCESS
    assert data["status"] == "AUTHENTICATED"
    assert data["transaction_id"] == txn_id
    assert "AUTHENTICATED" in data["message"]

    # 2. Verify in PostgreSQL that status is AUTHENTICATED alone
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        assert txn.status == "AUTHENTICATED"
        # OTP hash must be cleared to prevent replay/reuse
        assert txn.otp_hash is None
    finally:
        db.close()

    # 3. Complete payment lifecycle via /process
    process_res = client.post(f"/api/v1/payments/{txn_id}/process")
    assert process_res.status_code == 200
    p_data = process_res.json()
    assert p_data["status"] == "SUCCESS"

    # Verify final SUCCESS in DB
    db = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        assert txn.status == "SUCCESS"
    finally:
        db.close()


def test_verify_otp_invalid_code_decrements_attempts(client: TestClient):
    """Test wrong OTP returns 400 and reports remaining attempts."""
    txn_id = create_pending_transaction(client, "DEMO-OTP-3")
    client.post(f"/api/v1/payments/{txn_id}/send-otp")

    verify_res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": "000000"},  # Wrong code
    )
    assert verify_res.status_code == 400
    assert "2 attempt(s) remaining" in verify_res.text

    # Verify attempts incremented in DB
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        assert txn.otp_attempts == 1
        assert txn.status == "PENDING"
    finally:
        db.close()


def test_expired_otp_rejection(client: TestClient):
    """Test that an expired OTP is rejected and marks transaction as FAILED."""
    txn_id = create_pending_transaction(client, "DEMO-OTP-EXP")
    send_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = send_res.json()["simulated_otp"]

    # Manually expire the OTP in database
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        txn.otp_expires_at = datetime.utcnow() - timedelta(minutes=10)
        db.commit()
    finally:
        db.close()

    res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": otp},
    )
    assert res.status_code == 400
    assert "expired" in res.text

    # Verify transaction status changed to FAILED
    db = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        assert txn.status == "FAILED"
    finally:
        db.close()


def test_otp_reuse_prohibited(client: TestClient):
    """Test that a verified OTP cannot be reused."""
    txn_id = create_pending_transaction(client, "DEMO-OTP-REUSE")
    send_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = send_res.json()["simulated_otp"]

    # First verification succeeds -> AUTHENTICATED
    v1 = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})
    assert v1.status_code == 200
    assert v1.json()["status"] == "AUTHENTICATED"

    # Second verification attempt must be rejected (HTTP 400)
    v2 = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})
    assert v2.status_code == 400
    assert "cannot be verified" in v2.text or "No active" in v2.text


def test_three_attempt_lockout(client: TestClient):
    """Test 3 consecutive failed OTP attempts locks verification to FAILED."""
    txn_id = create_pending_transaction(client, "DEMO-OTP-LOCK")
    send_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    correct_otp = send_res.json()["simulated_otp"]

    # Attempt 1
    r1 = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": "111111"})
    assert r1.status_code == 400

    # Attempt 2
    r2 = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": "222222"})
    assert r2.status_code == 400

    # Attempt 3 (Max attempts reached)
    r3 = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": "333333"})
    assert r3.status_code == 400
    assert "FAILED" in r3.text

    # Even with correct OTP afterwards, verification must fail
    r4 = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": correct_otp})
    assert r4.status_code == 400
    assert "FAILED" in r4.text

    # Verify transaction status in DB is FAILED
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        assert txn.status == "FAILED"
        assert txn.otp_attempts == 3
    finally:
        db.close()


def test_previous_otp_invalidation_on_resend(client: TestClient):
    """Test resending an OTP invalidates the previous code."""
    txn_id = create_pending_transaction(client, "DEMO-OTP-INVALIDATE")
    send_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    first_otp = send_res.json()["simulated_otp"]

    # Fast-forward cooldown in DB
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        txn.last_otp_sent_at = datetime.utcnow() - timedelta(seconds=35)
        db.commit()
    finally:
        db.close()

    resend_res = client.post(f"/api/v1/payments/{txn_id}/resend-otp")
    assert resend_res.status_code == 200
    new_otp = resend_res.json()["simulated_otp"]

    # Previous OTP must be rejected
    if first_otp != new_otp:
        failed_res = client.post(
            f"/api/v1/payments/{txn_id}/verify-otp",
            json={"otp": first_otp},
        )
        assert failed_res.status_code == 400

    # New OTP must verify successfully
    success_res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": new_otp},
    )
    assert success_res.status_code == 200
    assert success_res.json()["status"] == "AUTHENTICATED"


def test_backend_resend_cooldown_enforced(client: TestClient):
    """Test that requesting OTP resend before cooldown window expires returns HTTP 429."""
    txn_id = create_pending_transaction(client, "DEMO-OTP-COOLDOWN")
    client.post(f"/api/v1/payments/{txn_id}/send-otp")

    # Immediate second request should be blocked by 30s cooldown
    immediate_res = client.post(f"/api/v1/payments/{txn_id}/resend-otp")
    assert immediate_res.status_code == 429
    assert "wait" in immediate_res.text.lower()

    # Fast forward cooldown timestamp by 31 seconds
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        txn.last_otp_sent_at = datetime.utcnow() - timedelta(seconds=31)
        db.commit()
    finally:
        db.close()

    # Allowed after cooldown
    allowed_res = client.post(f"/api/v1/payments/{txn_id}/resend-otp")
    assert allowed_res.status_code == 200
    assert allowed_res.json()["resend_count"] == 1


def test_maximum_resend_enforcement(client: TestClient):
    """Test that requesting more than 3 resends returns HTTP 429."""
    txn_id = create_pending_transaction(client, "DEMO-OTP-MAX-RESEND")
    client.post(f"/api/v1/payments/{txn_id}/send-otp")

    # Perform 3 allowed resends (advancing cooldown each time)
    for i in range(1, 4):
        db: Session = SessionLocal()
        try:
            txn = (
                db.query(PaymentTransaction)
                .filter(PaymentTransaction.transaction_id == txn_id)
                .first()
            )
            txn.last_otp_sent_at = datetime.utcnow() - timedelta(seconds=35)
            db.commit()
        finally:
            db.close()

        res = client.post(f"/api/v1/payments/{txn_id}/resend-otp")
        assert res.status_code == 200
        assert res.json()["resend_count"] == i

    # 4th resend attempt exceeds limit
    db = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        txn.last_otp_sent_at = datetime.utcnow() - timedelta(seconds=35)
        db.commit()
    finally:
        db.close()

    over_limit = client.post(f"/api/v1/payments/{txn_id}/resend-otp")
    assert over_limit.status_code == 429
    assert "limit" in over_limit.text


def test_production_otp_exposure_disabled(client: TestClient, monkeypatch):
    """Test that simulated_otp is strictly None in production environment."""
    txn_id = create_pending_transaction(client, "DEMO-OTP-PROD")

    # Set environment to production
    monkeypatch.setattr(settings, "environment", "production")

    send_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    assert send_res.status_code == 200
    assert send_res.json()["simulated_otp"] is None

    # Advance cooldown
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == txn_id)
            .first()
        )
        txn.last_otp_sent_at = datetime.utcnow() - timedelta(seconds=35)
        db.commit()
    finally:
        db.close()

    resend_res = client.post(f"/api/v1/payments/{txn_id}/resend-otp")
    assert resend_res.status_code == 200
    assert resend_res.json()["simulated_otp"] is None


def test_constant_time_verification_and_keyed_hmac():
    """Verify that compute_otp_hmac and verify_otp_hmac work correctly and use constant time."""
    tx_1 = "TXN_ALPHA"
    tx_2 = "TXN_BETA"
    otp = "654321"

    h1 = compute_otp_hmac(tx_1, otp)
    h2 = compute_otp_hmac(tx_2, otp)

    # 1. Transaction binding: same OTP generates different hash for different transactions
    assert h1 != h2

    # 2. Correct OTP matches
    assert verify_otp_hmac(tx_1, otp, h1) is True
    # 3. Wrong OTP rejected
    assert verify_otp_hmac(tx_1, "111111", h1) is False
    # 4. Cross-transaction replay rejected
    assert verify_otp_hmac(tx_2, otp, h1) is False


def test_cannot_verify_otp_for_invalid_or_completed_transaction(client: TestClient):
    """Test that OTP cannot be verified for non-existent or already completed transactions."""
    # Nonexistent transaction
    res = client.post("/api/v1/payments/TXN_NONEXISTENT/verify-otp", json={"otp": "123456"})
    assert res.status_code == 404

    # Completed transaction
    txn_id = create_pending_transaction(client, "DEMO-OTP-COMPLETED")
    send_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = send_res.json()["simulated_otp"]

    # Verify -> AUTHENTICATED
    v_res = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})
    assert v_res.status_code == 200

    # Process -> SUCCESS
    p_res = client.post(f"/api/v1/payments/{txn_id}/process")
    assert p_res.status_code == 200
    assert p_res.json()["status"] == "SUCCESS"

    # Attempt to verify OTP on SUCCESS transaction
    repeat_res = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})
    assert repeat_res.status_code == 400
    assert "cannot be verified" in repeat_res.text or "SUCCESS" in repeat_res.text


def test_process_payment_deterministic_outcomes(client: TestClient):
    """Test deterministic outcome simulation for DECLINED, FAILED, and SUCCESS."""
    # 1. Trigger DECLINED via Order ID pattern
    txn_id_decline = create_pending_transaction(client, "DEMO-ORD-DECLINE-01")
    s_res = client.post(f"/api/v1/payments/{txn_id_decline}/send-otp")
    otp_decline = s_res.json()["simulated_otp"]
    client.post(f"/api/v1/payments/{txn_id_decline}/verify-otp", json={"otp": otp_decline})

    p_decline = client.post(f"/api/v1/payments/{txn_id_decline}/process")
    assert p_decline.status_code == 200
    assert p_decline.json()["status"] == "DECLINED"

    # Verify in DB
    db: Session = SessionLocal()
    try:
        txn = db.query(PaymentTransaction).filter(PaymentTransaction.transaction_id == txn_id_decline).first()
        assert txn.status == "DECLINED"
    finally:
        db.close()

    # 2. Trigger FAILED via Order ID pattern
    txn_id_fail = create_pending_transaction(client, "DEMO-ORD-FAIL-01")
    s_res = client.post(f"/api/v1/payments/{txn_id_fail}/send-otp")
    otp_fail = s_res.json()["simulated_otp"]
    client.post(f"/api/v1/payments/{txn_id_fail}/verify-otp", json={"otp": otp_fail})

    p_fail = client.post(f"/api/v1/payments/{txn_id_fail}/process")
    assert p_fail.status_code == 200
    assert p_fail.json()["status"] == "FAILED"

    # 3. Trigger DECLINED explicitly via payload
    txn_id_explicit = create_pending_transaction(client, "DEMO-NORMAL-ORDER")
    s_res = client.post(f"/api/v1/payments/{txn_id_explicit}/send-otp")
    otp_exp = s_res.json()["simulated_otp"]
    client.post(f"/api/v1/payments/{txn_id_explicit}/verify-otp", json={"otp": otp_exp})

    p_explicit = client.post(f"/api/v1/payments/{txn_id_explicit}/process", json={"outcome": "DECLINED"})
    assert p_explicit.status_code == 200
    assert p_explicit.json()["status"] == "DECLINED"
