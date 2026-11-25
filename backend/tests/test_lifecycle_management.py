import uuid
from datetime import datetime
import pytest
from fastapi.testclient import TestClient
from fastapi import HTTPException
from app.services.payment_service import validate_state_transition, VALID_TRANSITIONS


def test_successful_transaction_lifecycle(client: TestClient):
    """
    Validates complete successful payment lifecycle:
    PENDING -> AUTHENTICATED -> PROCESSING -> SUCCESS.
    Ensures timestamps (created_at, updated_at, finalized_at) and OTP hash clearance.
    """
    order_id = f"ORD-LIFECYCLE-SUCC-{uuid.uuid4().hex[:6]}"
    # 1. Initiate (PENDING)
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": 1499.0,
            "currency": "INR",
            "payment_method": "CARD",
            "card_details": {
                "card_number": "4111222233334444",
                "expiry": "12/28",
                "cvv": "123",
                "card_holder": "LIFECYCLE TESTER",
            },
            "customer_email": "tester@juspay.demo",
        },
    )
    assert init_res.status_code == 201
    init_data = init_res.json()
    txn_id = init_data["transaction_id"]
    assert init_data["status"] == "PENDING"

    # Status API should show PENDING and finalized_at is None
    status_res = client.get(f"/api/v1/payments/{txn_id}")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["status"] == "PENDING"
    assert status_data["current_status"] == "PENDING"
    assert status_data["is_finalized"] is False
    assert status_data["finalized_at"] is None

    # 2. Send & Verify OTP (AUTHENTICATED)
    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    assert otp_res.status_code == 200
    otp = otp_res.json()["simulated_otp"]

    verify_res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": otp},
    )
    assert verify_res.status_code == 200
    verify_data = verify_res.json()
    assert verify_data["status"] == "AUTHENTICATED"
    assert "otp_hash" not in verify_data or verify_data.get("otp_hash") is None

    # 3. Process Payment (PROCESSING -> SUCCESS)
    proc_res = client.post(
        f"/api/v1/payments/{txn_id}/process",
        json={"outcome": "SUCCESS"},
    )
    assert proc_res.status_code == 200
    proc_data = proc_res.json()
    assert proc_data["status"] == "SUCCESS"
    assert proc_data["finalized_at"] is not None

    # 4. Authoritative Status Verification
    final_res = client.get(f"/api/v1/payments/{txn_id}")
    assert final_res.status_code == 200
    final_data = final_res.json()
    assert final_data["status"] == "SUCCESS"
    assert final_data["current_status"] == "SUCCESS"
    assert final_data["is_finalized"] is True
    assert final_data["finalized_at"] is not None
    assert final_data["payment_reference"] == init_data["payment_reference"]
    assert final_data["order_id"] == order_id
    assert final_data["amount"] == 1499.0
    assert final_data["payment_method"] == "CARD"


def test_declined_transaction_lifecycle(client: TestClient):
    """
    Validates complete declined payment lifecycle:
    PENDING -> AUTHENTICATED -> PROCESSING -> DECLINED.
    """
    order_id = f"ORD-LIFECYCLE-DECL-{uuid.uuid4().hex[:6]}"
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": 499.0,
            "currency": "INR",
            "payment_method": "UPI",
            "upi_details": {"upi_id": "tester@okaxis"},
            "customer_email": "tester@juspay.demo",
        },
    )
    assert init_res.status_code == 201
    txn_id = init_res.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]

    verify_res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": otp},
    )
    assert verify_res.status_code == 200
    assert verify_res.json()["status"] == "AUTHENTICATED"

    proc_res = client.post(
        f"/api/v1/payments/{txn_id}/process",
        json={"outcome": "DECLINED"},
    )
    assert proc_res.status_code == 200
    proc_data = proc_res.json()
    assert proc_data["status"] == "DECLINED"
    assert proc_data["finalized_at"] is not None

    status_res = client.get(f"/api/v1/payments/{txn_id}")
    assert status_res.status_code == 200
    status_data = status_res.json()
    assert status_data["status"] == "DECLINED"
    assert status_data["is_finalized"] is True
    assert status_data["finalized_at"] is not None


def test_failed_transaction_lifecycle_via_outcome(client: TestClient):
    """
    Validates complete failed payment lifecycle:
    PENDING -> AUTHENTICATED -> PROCESSING -> FAILED.
    """
    order_id = f"ORD-LIFECYCLE-FAIL-{uuid.uuid4().hex[:6]}"
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": 750.0,
            "currency": "INR",
            "payment_method": "NET_BANKING",
            "netbanking_details": {"bank_code": "HDFC"},
            "customer_email": "tester@juspay.demo",
        },
    )
    assert init_res.status_code == 201
    txn_id = init_res.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]

    verify_res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": otp},
    )
    assert verify_res.status_code == 200

    proc_res = client.post(
        f"/api/v1/payments/{txn_id}/process",
        json={"outcome": "FAILED"},
    )
    assert proc_res.status_code == 200
    proc_data = proc_res.json()
    assert proc_data["status"] == "FAILED"
    assert proc_data["finalized_at"] is not None

    status_res = client.get(f"/api/v1/payments/{txn_id}")
    assert status_res.json()["is_finalized"] is True
    assert status_res.json()["finalized_at"] is not None


def test_failed_transaction_lifecycle_via_otp_lockout(client: TestClient):
    """
    Validates payment failure through 3 wrong OTP attempts:
    PENDING -> FAILED (lockout), with finalized_at populated and otp_hash cleared.
    """
    order_id = f"ORD-LIFECYCLE-LOCK-{uuid.uuid4().hex[:6]}"
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": 350.0,
            "currency": "INR",
            "payment_method": "UPI",
            "upi_details": {"upi_id": "tester@okaxis"},
        },
    )
    txn_id = init_res.json()["transaction_id"]
    client.post(f"/api/v1/payments/{txn_id}/send-otp")

    # 3 incorrect attempts
    client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": "000000"})
    client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": "000000"})
    lock_res = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": "000000"})
    assert lock_res.status_code == 400
    assert "FAILED" in lock_res.json()["detail"]

    # Transaction status must now be FAILED and finalized
    status_res = client.get(f"/api/v1/payments/{txn_id}")
    status_data = status_res.json()
    assert status_data["status"] == "FAILED"
    assert status_data["is_finalized"] is True
    assert status_data["finalized_at"] is not None


def test_invalid_state_transitions_rejected(client: TestClient):
    """
    Verifies that invalid state transitions are rejected by the backend.
    """
    # 1. Backend validator function directly
    with pytest.raises(HTTPException) as exc_info:
        validate_state_transition("SUCCESS", "PENDING")
    assert exc_info.value.status_code == 400
    assert "Invalid transaction status transition" in exc_info.value.detail

    with pytest.raises(HTTPException) as exc_info:
        validate_state_transition("PENDING", "PROCESSING")
    assert exc_info.value.status_code == 400

    with pytest.raises(HTTPException) as exc_info:
        validate_state_transition("FAILED", "SUCCESS")
    assert exc_info.value.status_code == 400

    # 2. Cannot process payment while still PENDING
    order_id = f"ORD-INVALID-TRANS-{uuid.uuid4().hex[:6]}"
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": 200.0,
            "currency": "INR",
            "payment_method": "UPI",
            "upi_details": {"upi_id": "tester@okaxis"},
        },
    )
    txn_id = init_res.json()["transaction_id"]

    # Attempt to process without OTP verification
    proc_res = client.post(f"/api/v1/payments/{txn_id}/process")
    assert proc_res.status_code == 400
    assert "Invalid transaction status transition" in proc_res.json()["detail"] or "AUTHENTICATED" in proc_res.json()["detail"]


def test_transaction_status_api(client: TestClient):
    """
    Tests GET /api/v1/payments/{transaction_id} returns all required fields and masks sensitive details.
    """
    order_id = f"ORD-STATUS-API-{uuid.uuid4().hex[:6]}"
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": 999.0,
            "currency": "INR",
            "payment_method": "CARD",
            "card_details": {
                "card_number": "4111222233334444",
                "expiry": "12/28",
                "cvv": "123",
                "card_holder": "STATUS TEST",
            },
            "customer_email": "demo.user@juspay.demo",
        },
    )
    txn_id = init_res.json()["transaction_id"]

    res = client.get(f"/api/v1/payments/{txn_id}")
    assert res.status_code == 200
    data = res.json()

    assert data["transaction_id"] == txn_id
    assert "payment_reference" in data
    assert data["order_id"] == order_id
    assert data["amount"] == 999.0
    assert data["currency"] == "INR"
    assert data["payment_method"] == "CARD"
    assert data["status"] == "PENDING"
    assert data["current_status"] == "PENDING"
    assert data["is_finalized"] is False
    assert "created_at" in data
    assert "updated_at" in data
    assert data["customer_email"] == "de****@juspay.demo"


def test_transaction_status_api_missing_handling(client: TestClient):
    """
    Tests GET /api/v1/payments/{transaction_id} handles non-existent transaction IDs cleanly with 404.
    """
    res = client.get("/api/v1/payments/TXN_NON_EXISTENT_000000")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_transaction_history_pagination(client: TestClient):
    """
    Tests GET /api/v1/payments pagination parameters (page, limit) and newest-first sorting.
    """
    res = client.get("/api/v1/payments?page=1&limit=5")
    assert res.status_code == 200
    data = res.json()

    assert "items" in data
    assert "total" in data
    assert "page" in data
    assert "limit" in data
    assert "pages" in data

    assert data["page"] == 1
    assert data["limit"] == 5
    assert len(data["items"]) <= 5

    # Check newest-first sorting
    items = data["items"]
    if len(items) >= 2:
        for i in range(len(items) - 1):
            assert items[i]["created_at"] >= items[i + 1]["created_at"]


def test_transaction_history_filtering_by_status_and_method(client: TestClient):
    """
    Tests filtering in GET /api/v1/payments by status and payment_method.
    """
    # 1. Filter by status=SUCCESS
    res_success = client.get("/api/v1/payments?status=SUCCESS&limit=10")
    assert res_success.status_code == 200
    for item in res_success.json()["items"]:
        assert item["status"] == "SUCCESS"

    # 2. Filter by payment_method=CARD
    res_card = client.get("/api/v1/payments?payment_method=CARD&limit=10")
    assert res_card.status_code == 200
    for item in res_card.json()["items"]:
        assert item["payment_method"] == "CARD"

    # 3. Filter by both status=SUCCESS and payment_method=UPI
    res_both = client.get("/api/v1/payments?status=SUCCESS&payment_method=UPI&limit=10")
    assert res_both.status_code == 200
    for item in res_both.json()["items"]:
        assert item["status"] == "SUCCESS"
        assert item["payment_method"] == "UPI"


def test_sensitive_data_exclusion_in_status_and_history(client: TestClient):
    """
    Verifies that neither GET /{transaction_id} nor GET / returns any OTP, hashes,
    raw cards, CVVs, or secret values.
    """
    # Create and authenticate a transaction
    order_id = f"ORD-SENSITIVE-CHECK-{uuid.uuid4().hex[:6]}"
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": 890.0,
            "currency": "INR",
            "payment_method": "CARD",
            "card_details": {
                "card_number": "4111222233334444",
                "expiry": "12/28",
                "cvv": "123",
                "card_holder": "SECURITY AUDITOR",
            },
            "customer_email": "auditor@juspay.demo",
        },
    )
    txn_id = init_res.json()["transaction_id"]

    # Check status endpoint payload keys
    status_res = client.get(f"/api/v1/payments/{txn_id}")
    status_keys = status_res.json().keys()
    for forbidden in ["otp", "otp_hash", "otp_secret", "card_number", "cvv", "card_cvv"]:
        assert forbidden not in status_keys

    # Check history endpoint payload keys
    history_res = client.get("/api/v1/payments?limit=3")
    for item in history_res.json()["items"]:
        item_keys = item.keys()
        for forbidden in ["otp", "otp_hash", "otp_secret", "card_number", "cvv", "card_cvv"]:
            assert forbidden not in item_keys


def test_repeated_processing_and_idempotency(client: TestClient):
    """
    Verifies duplicate processing protection (409 Conflict) and idempotent replay with Idempotency-Key.
    """
    order_id = f"ORD-REPLAY-TEST-{uuid.uuid4().hex[:6]}"
    idempotency_key = f"IDEMP-KEY-{uuid.uuid4().hex}"

    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": 1200.0,
            "currency": "INR",
            "payment_method": "UPI",
            "upi_details": {"upi_id": "replay@okaxis"},
        },
    )
    txn_id = init_res.json()["transaction_id"]

    otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    otp = otp_res.json()["simulated_otp"]

    client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})

    # Process with idempotency key
    proc1 = client.post(
        f"/api/v1/payments/{txn_id}/process",
        headers={"Idempotency-Key": idempotency_key},
        json={"outcome": "SUCCESS"},
    )
    assert proc1.status_code == 200
    assert proc1.json()["status"] == "SUCCESS"

    # Repeated process without idempotency key -> 409 Conflict
    proc2 = client.post(
        f"/api/v1/payments/{txn_id}/process",
        json={"outcome": "SUCCESS"},
    )
    assert proc2.status_code == 409
    assert "already been processed" in proc2.json()["detail"]

    # Repeated process WITH SAME idempotency key -> 200 OK (idempotent replay)
    proc3 = client.post(
        f"/api/v1/payments/{txn_id}/process",
        headers={"Idempotency-Key": idempotency_key},
        json={"outcome": "SUCCESS"},
    )
    assert proc3.status_code == 200
    assert proc3.json()["status"] == "SUCCESS"
    assert proc3.json()["transaction_id"] == txn_id
