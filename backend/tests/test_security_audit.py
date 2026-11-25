import uuid
import pytest
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.database.session import SessionLocal
from app.models.payment import PaymentTransaction
from app.core.config import settings
from app.core.clock import set_test_clock_offset, reset_test_clock_offset


def create_transaction_payload(order_id: str, payment_method: str = "CARD", amount: float = 999.00):
    payload = {
        "order_id": order_id,
        "amount": amount,
        "currency": "INR",
        "payment_method": payment_method,
    }
    if payment_method == "CARD":
        payload["card_details"] = {
            "card_number": "4111222233334444",
            "expiry": "12/28",
            "cvv": "123",
            "card_holder": "AUDIT TESTER",
        }
    elif payment_method == "UPI":
        payload["upi_details"] = {"upi_id": "audit.tester@okaxis"}
    elif payment_method == "NET_BANKING":
        payload["netbanking_details"] = {"bank_code": "HDFC"}
    return payload


# ==============================================================================
# 1. PRODUCTION SECURITY AUDIT TESTS
# ==============================================================================

def test_production_mode_blocks_direct_simulation_outcome_overrides(client: TestClient, monkeypatch):
    """
    In production mode (settings.environment = 'production'), direct API requests
    attempting to override payment outcome with ?outcome=DECLINED or payload must be rejected with 403 Forbidden.
    """
    # 1. Initiate and authenticate in development mode
    order_id = f"PROD-AUDIT-OVERRIDE-{uuid.uuid4().hex[:6]}"
    res = client.post("/api/v1/payments/initiate", json=create_transaction_payload(order_id))
    assert res.status_code == 201
    txn_id = res.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]

    verify_res = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})
    assert verify_res.status_code == 200
    assert verify_res.json()["status"] == "AUTHENTICATED"

    # 2. Switch environment to production
    monkeypatch.setattr(settings, "environment", "production")
    assert settings.is_development is False
    assert settings.is_production is True

    # 3. Direct API request attempting outcome override must return 403 Forbidden
    override_res = client.post(
        f"/api/v1/payments/{txn_id}/process",
        json={"outcome": "DECLINED"},
    )
    assert override_res.status_code == 403
    assert "Simulation outcome overrides are disabled in production" in override_res.json()["detail"]

    # Also test via query parameter ?outcome=FAILED
    override_query_res = client.post(
        f"/api/v1/payments/{txn_id}/process?outcome=FAILED"
    )
    assert override_query_res.status_code == 403


def test_production_mode_blocks_test_scenario_order_ids(client: TestClient, monkeypatch):
    """
    In production mode, initiating transactions with test scenario order IDs
    (containing DECLINE or FAIL) must be blocked with 403 Forbidden.
    """
    monkeypatch.setattr(settings, "environment", "production")

    # Attempt DECLINE order
    res_decline = client.post(
        "/api/v1/payments/initiate",
        json=create_transaction_payload("DEMO-ORD-DECLINE-PROD"),
    )
    assert res_decline.status_code == 403
    assert "Test scenario order IDs and email triggers are disabled in production" in res_decline.json()["detail"]

    # Attempt FAIL order
    res_fail = client.post(
        "/api/v1/payments/initiate",
        json=create_transaction_payload("DEMO-ORD-FAIL-PROD"),
    )
    assert res_fail.status_code == 403


def test_production_mode_hides_simulated_otp_and_secrets(client: TestClient, monkeypatch):
    """
    In production mode, send-otp and resend-otp must return simulated_otp as None,
    and API responses/logs must not leak secrets or card details.
    """
    order_id = f"PROD-SECRETS-{uuid.uuid4().hex[:6]}"
    init_res = client.post("/api/v1/payments/initiate", json=create_transaction_payload(order_id))
    assert init_res.status_code == 201
    txn_id = init_res.json()["transaction_id"]

    # Switch to production
    monkeypatch.setattr(settings, "environment", "production")

    send_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    assert send_res.status_code == 200
    assert send_res.json()["simulated_otp"] is None

    # Verify status response does not expose hash
    status_res = client.get(f"/api/v1/payments/{txn_id}/otp-status")
    assert status_res.status_code == 200
    status_dict = status_res.json()
    assert "otp_hash" not in status_dict
    assert "otp" not in status_dict


# ==============================================================================
# 2. DETERMINISTIC OTP EXPIRY TESTS
# ==============================================================================

def test_deterministic_otp_expiry_with_controllable_clock(client: TestClient):
    """
    Tests that an OTP is deterministically rejected when expired using the controllable clock header.
    No 5-minute real-time wait required.
    """
    order_id = f"EXPIRY-AUDIT-{uuid.uuid4().hex[:6]}"
    init_res = client.post("/api/v1/payments/initiate", json=create_transaction_payload(order_id))
    txn_id = init_res.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]
    assert otp is not None

    # Simulate 360 seconds (6 minutes) passing via X-Test-Clock-Offset header
    expired_verify_res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": otp},
        headers={"X-Test-Clock-Offset": "360.0"},
    )
    assert expired_verify_res.status_code == 400
    assert "OTP has expired. Transaction marked as FAILED." in expired_verify_res.json()["detail"]

    # Verify PostgreSQL state: status must be FAILED, otp_hash must be cleared
    db: Session = SessionLocal()
    try:
        txn = db.query(PaymentTransaction).filter(PaymentTransaction.transaction_id == txn_id).first()
        assert txn.status == "FAILED"
        assert txn.otp_hash is None
    finally:
        db.close()


def test_expired_otp_cannot_become_authenticated_or_success(client: TestClient):
    """
    Verifies that after an OTP expires, the payment NEVER becomes AUTHENTICATED or SUCCESS.
    Subsequent calls to /process must fail.
    """
    order_id = f"EXPIRY-LIFECYCLE-{uuid.uuid4().hex[:6]}"
    init_res = client.post("/api/v1/payments/initiate", json=create_transaction_payload(order_id))
    txn_id = init_res.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]

    # Expire the OTP
    client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": otp},
        headers={"X-Test-Clock-Offset": "310.0"},
    )

    # Attempting to process the payment must fail (409 Conflict because status is already finalized FAILED)
    process_res = client.post(f"/api/v1/payments/{txn_id}/process")
    assert process_res.status_code in (400, 409)
    assert "already been processed with final status 'FAILED'" in process_res.json()["detail"] or "must be in 'AUTHENTICATED' state" in process_res.json()["detail"]

    # Re-verifying OTP on the failed transaction must also be rejected
    reverify_res = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})
    assert reverify_res.status_code == 400
    assert "already in 'FAILED' state" in reverify_res.json()["detail"]


def test_production_mode_ignores_clock_offset_header(client: TestClient, monkeypatch):
    """
    In production mode, X-Test-Clock-Offset header must be strictly ignored.
    """
    order_id = f"PROD-CLOCK-{uuid.uuid4().hex[:6]}"
    init_res = client.post("/api/v1/payments/initiate", json=create_transaction_payload(order_id))
    txn_id = init_res.json()["transaction_id"]

    # Get OTP in dev before switching
    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]

    # Switch to production
    monkeypatch.setattr(settings, "environment", "production")

    # In production, submitting with X-Test-Clock-Offset: 360 should NOT expire the OTP immediately,
    # because the clock offset is ignored and real current UTC time is used (which is < 5 minutes).
    verify_res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": otp},
        headers={"X-Test-Clock-Offset": "360.0"},
    )
    # Must succeed (not expired) because offset was ignored in production!
    assert verify_res.status_code == 200
    assert verify_res.json()["status"] == "AUTHENTICATED"


# ==============================================================================
# 3. BACKEND DUPLICATE PAYMENT & IDEMPOTENCY PROTECTION TESTS
# ==============================================================================

def test_duplicate_payment_initiation_on_completed_order_blocked(client: TestClient):
    """
    Tests that once an order has been successfully completed (status = SUCCESS),
    any subsequent attempt to initiate a new payment for the same order_id is rejected with 409 Conflict.
    """
    order_id = f"ORDER-ONCE-{uuid.uuid4().hex[:8]}"

    # Step 1: Complete the first payment
    init_1 = client.post("/api/v1/payments/initiate", json=create_transaction_payload(order_id))
    assert init_1.status_code == 201
    txn_1_id = init_1.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_1_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]

    v_res = client.post(f"/api/v1/payments/{txn_1_id}/verify-otp", json={"otp": otp})
    assert v_res.status_code == 200

    p_res = client.post(f"/api/v1/payments/{txn_1_id}/process")
    assert p_res.status_code == 200
    assert p_res.json()["status"] == "SUCCESS"

    # Step 2: Attempt duplicate initiation for the SAME order_id
    duplicate_init = client.post("/api/v1/payments/initiate", json=create_transaction_payload(order_id))
    assert duplicate_init.status_code == 409
    assert "has already been successfully paid" in duplicate_init.json()["detail"]


def test_idempotent_payment_initiation_with_idempotency_key(client: TestClient):
    """
    Tests that repeating POST /initiate with the same Idempotency-Key
    safely returns the original transaction rather than creating duplicate records.
    """
    order_id = f"IDEMP-INIT-{uuid.uuid4().hex[:8]}"
    idemp_key = f"idemp-key-{uuid.uuid4().hex}"

    # First initiation
    res_1 = client.post(
        "/api/v1/payments/initiate",
        json=create_transaction_payload(order_id),
        headers={"Idempotency-Key": idemp_key},
    )
    assert res_1.status_code == 201
    txn_1 = res_1.json()

    # Second identical initiation with same Idempotency-Key
    res_2 = client.post(
        "/api/v1/payments/initiate",
        json=create_transaction_payload(order_id),
        headers={"Idempotency-Key": idemp_key},
    )
    assert res_2.status_code in (200, 201)
    txn_2 = res_2.json()

    # Must return exact same transaction ID and payment reference
    assert txn_1["transaction_id"] == txn_2["transaction_id"]
    assert txn_1["payment_reference"] == txn_2["payment_reference"]


def test_duplicate_payment_processing_blocked(client: TestClient):
    """
    Tests that repeated calls to POST /{transaction_id}/process on an already finalized
    transaction (without idempotency key) are rejected with 409 Conflict.
    """
    order_id = f"DUP-PROCESS-{uuid.uuid4().hex[:8]}"
    init_res = client.post("/api/v1/payments/initiate", json=create_transaction_payload(order_id))
    txn_id = init_res.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]

    client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})

    # First process call -> 200 SUCCESS
    proc_1 = client.post(f"/api/v1/payments/{txn_id}/process")
    assert proc_1.status_code == 200
    assert proc_1.json()["status"] == "SUCCESS"

    # Second immediate process call -> 409 Conflict
    proc_2 = client.post(f"/api/v1/payments/{txn_id}/process")
    assert proc_2.status_code == 409
    assert "has already been processed" in proc_2.json()["detail"]


def test_idempotent_payment_processing_with_idempotency_key(client: TestClient):
    """
    Tests that re-submitting POST /{transaction_id}/process with the same Idempotency-Key
    returns the already finalized transaction safely without duplicate processing.
    """
    order_id = f"IDEMP-PROCESS-{uuid.uuid4().hex[:8]}"
    idemp_key = f"process-idemp-{uuid.uuid4().hex}"

    init_res = client.post("/api/v1/payments/initiate", json=create_transaction_payload(order_id))
    txn_id = init_res.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]

    client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})

    # First call with Idempotency-Key
    res_1 = client.post(
        f"/api/v1/payments/{txn_id}/process",
        headers={"Idempotency-Key": idemp_key},
    )
    assert res_1.status_code == 200
    assert res_1.json()["status"] == "SUCCESS"

    # Second identical call with same Idempotency-Key
    res_2 = client.post(
        f"/api/v1/payments/{txn_id}/process",
        headers={"Idempotency-Key": idemp_key},
    )
    assert res_2.status_code == 200
    assert res_2.json()["status"] == "SUCCESS"
    assert res_2.json()["transaction_id"] == txn_id
