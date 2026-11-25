import pytest
from fastapi.testclient import TestClient


def test_payment_initiation_for_store_order_uses_authoritative_total(client: TestClient):
    """
    Verify payment initiation for a store order validates against authoritative backend amount.
    """
    # 1. Create a store order
    order_payload = {
        "items": [{"product_id": "STK-001", "quantity": 1}],  # 99 + 50 = 149.0
        "delivery": {
            "full_name": "Rohan Sharma",
            "mobile_number": "9876543210",
            "email": "rohan@example.com",
            "address_line": "123 Indiranagar 100ft Road",
            "city": "Bengaluru",
            "state": "Karnataka",
            "pincode": "560038",
        },
    }
    order_res = client.post("/api/v1/store/orders", json=order_payload)
    assert order_res.status_code == 201
    order_data = order_res.json()
    order_id = order_data["order_id"]
    order_token = order_data["order_token"]
    assert order_data["total_amount"] == 149.0

    # 2. Initiate payment with matching authoritative amount
    init_payload = {
        "order_id": order_id,
        "amount": 149.0,
        "currency": "INR",
        "payment_method": "CARD",
        "customer_email": "rohan@example.com",
        "card_details": {
            "card_number": "4111 2222 3333 4444",
            "expiry": "12/28",
            "cvv": "123",
            "card_holder": "ROHAN SHARMA",
        },
    }
    pay_res = client.post("/api/v1/payments/initiate", json=init_payload)
    assert pay_res.status_code == 201
    pay_data = pay_res.json()
    assert pay_data["order_id"] == order_id
    assert pay_data["amount"] == 149.0
    assert pay_data["status"] == "PENDING"


def test_tampered_frontend_amount_is_rejected(client: TestClient):
    """
    Verify that if a client attempts to submit a tampered order amount (e.g. ₹1 instead of ₹149),
    the backend rejects it with HTTP 400 Bad Request.
    """
    order_payload = {
        "items": [{"product_id": "STK-001", "quantity": 1}],
        "delivery": {
            "full_name": "Malicious User",
            "mobile_number": "9876543210",
            "email": "attacker@example.com",
            "address_line": "Hidden Street 99",
            "city": "Bengaluru",
            "state": "Karnataka",
            "pincode": "560001",
        },
    }
    order_res = client.post("/api/v1/store/orders", json=order_payload)
    assert order_res.status_code == 201
    order_id = order_res.json()["order_id"]

    # Try to pay 1.00 INR instead of 149.00 INR
    tampered_payload = {
        "order_id": order_id,
        "amount": 1.0,
        "currency": "INR",
        "payment_method": "CARD",
        "customer_email": "attacker@example.com",
        "card_details": {
            "card_number": "4111 2222 3333 4444",
            "expiry": "12/28",
            "cvv": "123",
            "card_holder": "MALICIOUS USER",
        },
    }
    pay_res = client.post("/api/v1/payments/initiate", json=tampered_payload)
    assert pay_res.status_code == 400
    assert "Tampered amount rejected" in pay_res.json()["detail"]


def test_successful_payment_updates_store_order_to_paid(client: TestClient):
    """
    Complete full payment lifecycle for a store order and verify status becomes PAID:
    PENDING_PAYMENT -> Payment Initiated -> OTP Verified -> Process SUCCESS -> StoreOrder PAID.
    """
    # 1. Create order
    order_payload = {
        "items": [{"product_id": "STK-002", "quantity": 1}],
        "delivery": {
            "full_name": "Sunil Kumar",
            "mobile_number": "9123456789",
            "email": "sunil@example.com",
            "address_line": "55 Brigade Road",
            "city": "Bengaluru",
            "state": "Karnataka",
            "pincode": "560025",
        },
    }
    order_res = client.post("/api/v1/store/orders", json=order_payload)
    assert order_res.status_code == 201
    order_data = order_res.json()
    order_id = order_data["order_id"]
    order_token = order_data["order_token"]
    assert order_data["status"] == "PENDING_PAYMENT"

    # 2. Initiate payment
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "UPI",
            "customer_email": "sunil@example.com",
            "upi_details": {"upi_id": "sunil@okaxis", "app_name": "gpay"},
        },
    )
    assert init_res.status_code == 201
    txn_id = init_res.json()["transaction_id"]

    # 3. Send OTP
    send_otp_res = client.post(f"/api/v1/payments/{txn_id}/send-otp")
    assert send_otp_res.status_code == 200
    otp = send_otp_res.json()["simulated_otp"]

    # 4. Verify OTP
    verify_res = client.post(
        f"/api/v1/payments/{txn_id}/verify-otp",
        json={"otp": otp},
    )
    assert verify_res.status_code == 200
    assert verify_res.json()["status"] == "AUTHENTICATED"

    # Store order should still be PENDING_PAYMENT before final process
    check_order = client.get(f"/api/v1/store/orders/{order_id}", headers={"X-Order-Token": order_token})
    assert check_order.json()["status"] == "PENDING_PAYMENT"

    # 5. Process Payment -> SUCCESS
    process_res = client.post(
        f"/api/v1/payments/{txn_id}/process",
        json={"outcome": "SUCCESS"},
    )
    assert process_res.status_code == 200
    assert process_res.json()["status"] == "SUCCESS"

    # 6. Verify StoreOrder is now PAID
    updated_order = client.get(f"/api/v1/store/orders/{order_id}", headers={"X-Order-Token": order_token}).json()
    assert updated_order["status"] == "PAID"
    assert updated_order["payment_transaction_id"] == txn_id
    assert updated_order["payment_reference"] == process_res.json()["payment_reference"]


def test_cannot_pay_already_paid_store_order(client: TestClient):
    """
    Verify that once a store order is PAID, attempting to initiate another payment is blocked with HTTP 409.
    """
    # Create, initiate, and pay order
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-003", "quantity": 1}],
            "delivery": {
                "full_name": "Priya Singh",
                "mobile_number": "9876543210",
                "email": "priya@example.com",
                "address_line": "12 Residency Road",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560025",
            },
        },
    )
    order_data = order_res.json()
    order_id = order_data["order_id"]

    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "NET_BANKING",
            "customer_email": "priya@example.com",
            "netbanking_details": {"bank_code": "HDFC"},
        },
    )
    txn_id = init_res.json()["transaction_id"]
    otp = client.post(f"/api/v1/payments/{txn_id}/send-otp").json()["simulated_otp"]
    client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})
    client.post(f"/api/v1/payments/{txn_id}/process", json={"outcome": "SUCCESS"})

    # Attempt second payment initiation for the same order
    dup_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "UPI",
            "customer_email": "priya@example.com",
            "upi_details": {"upi_id": "priya@okaxis"},
        },
    )
    assert dup_res.status_code == 409
    assert "already been paid" in dup_res.json()["detail"].lower() or "duplicate" in dup_res.json()["detail"].lower()


def test_declined_payment_updates_store_order_to_failed_and_restores_stock(client: TestClient):
    """
    Verify that when a payment is DECLINED:
    - StoreOrder status becomes PAYMENT_FAILED.
    - Product stock is restored.
    """
    # 1. Check initial stock
    prod_before = client.get("/api/v1/store/products/STK-004").json()
    initial_stock = prod_before["stock_quantity"]

    # 2. Create order for 2 items
    qty = 2
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-004", "quantity": qty}],
            "delivery": {
                "full_name": "Decline Tester",
                "mobile_number": "9811223344",
                "email": "decline@example.com",
                "address_line": "100 Decline Way",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
        },
    )
    order_data = order_res.json()
    order_id = order_data["order_id"]
    order_token = order_data["order_token"]

    # Stock is deducted on order creation
    prod_during = client.get("/api/v1/store/products/STK-004").json()
    assert prod_during["stock_quantity"] == initial_stock - qty

    # 3. Initiate payment
    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "CARD",
            "customer_email": "decline@example.com",
            "card_details": {
                "card_number": "4111 2222 3333 4444",
                "expiry": "12/28",
                "cvv": "123",
                "card_holder": "DECLINE TESTER",
            },
        },
    )
    txn_id = init_res.json()["transaction_id"]
    otp = client.post(f"/api/v1/payments/{txn_id}/send-otp").json()["simulated_otp"]
    client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": otp})

    # 4. Process payment with outcome DECLINED
    process_res = client.post(f"/api/v1/payments/{txn_id}/process", json={"outcome": "DECLINED"})
    assert process_res.status_code == 200
    assert process_res.json()["status"] == "DECLINED"

    # 5. Verify StoreOrder is PAYMENT_FAILED
    order_after = client.get(f"/api/v1/store/orders/{order_id}", headers={"X-Order-Token": order_token}).json()
    assert order_after["status"] == "PAYMENT_FAILED"

    # 6. Verify stock has been restored!
    prod_after = client.get("/api/v1/store/products/STK-004").json()
    assert prod_after["stock_quantity"] == initial_stock


def test_failed_payment_via_otp_lockout_updates_store_order_to_failed_and_restores_stock(client: TestClient):
    """
    Verify that when OTP verification fails 3 times, transaction is locked to FAILED,
    StoreOrder status transitions to PAYMENT_FAILED, and stock is restored.
    """
    prod_before = client.get("/api/v1/store/products/STK-005").json()
    initial_stock = prod_before["stock_quantity"]

    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-005", "quantity": 1}],
            "delivery": {
                "full_name": "Lockout Tester",
                "mobile_number": "9811223344",
                "email": "lockout@example.com",
                "address_line": "100 Lockout Ave",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
        },
    )
    order_data = order_res.json()
    order_id = order_data["order_id"]
    order_token = order_data["order_token"]

    # Stock deducted
    assert client.get("/api/v1/store/products/STK-005").json()["stock_quantity"] == initial_stock - 1

    init_res = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "CARD",
            "customer_email": "lockout@example.com",
            "card_details": {
                "card_number": "4111 2222 3333 4444",
                "expiry": "12/28",
                "cvv": "123",
                "card_holder": "LOCKOUT TESTER",
            },
        },
    )
    txn_id = init_res.json()["transaction_id"]
    client.post(f"/api/v1/payments/{txn_id}/send-otp")

    # 3 incorrect OTP submissions
    for _ in range(2):
        res = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": "000000"})
        assert res.status_code == 400

    lockout_res = client.post(f"/api/v1/payments/{txn_id}/verify-otp", json={"otp": "000000"})
    assert lockout_res.status_code == 400
    assert "FAILED" in lockout_res.json()["detail"]

    # Check store order status
    order_check = client.get(f"/api/v1/store/orders/{order_id}", headers={"X-Order-Token": order_token}).json()
    assert order_check["status"] == "PAYMENT_FAILED"

    # Stock restored
    assert client.get("/api/v1/store/products/STK-005").json()["stock_quantity"] == initial_stock


def test_safe_payment_retry_after_failure_re_reserves_stock_and_completes(client: TestClient):
    """
    Verify that a customer can safely retry paying for an order that previously failed:
    1. Initial payment fails (stock restored).
    2. Customer retries payment (stock re-reserved, status PENDING_PAYMENT).
    3. Payment succeeds (order PAID, stock permanently sold).
    """
    prod_before = client.get("/api/v1/store/products/STK-006").json()
    initial_stock = prod_before["stock_quantity"]

    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-006", "quantity": 2}],
            "delivery": {
                "full_name": "Retry Customer",
                "mobile_number": "9811223344",
                "email": "retry@example.com",
                "address_line": "12 Retry Lane",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
        },
    )
    order_data = order_res.json()
    order_id = order_data["order_id"]
    order_token = order_data["order_token"]

    # First attempt fails via DECLINED
    init1 = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "CARD",
            "customer_email": "retry@example.com",
            "card_details": {"card_number": "4111 2222 3333 4444", "expiry": "12/28", "cvv": "123", "card_holder": "RETRY"},
        },
    )
    txn1 = init1.json()["transaction_id"]
    otp1 = client.post(f"/api/v1/payments/{txn1}/send-otp").json()["simulated_otp"]
    client.post(f"/api/v1/payments/{txn1}/verify-otp", json={"otp": otp1})
    client.post(f"/api/v1/payments/{txn1}/process", json={"outcome": "DECLINED"})

    # Order is PAYMENT_FAILED and stock restored
    order_status1 = client.get(f"/api/v1/store/orders/{order_id}", headers={"X-Order-Token": order_token}).json()
    assert order_status1["status"] == "PAYMENT_FAILED"
    assert client.get("/api/v1/store/products/STK-006").json()["stock_quantity"] == initial_stock

    # Customer Retries with UPI
    init2 = client.post(
        "/api/v1/payments/initiate",
        json={
            "order_id": order_id,
            "amount": order_data["total_amount"],
            "currency": "INR",
            "payment_method": "UPI",
            "customer_email": "retry@example.com",
            "upi_details": {"upi_id": "retry@okaxis", "app_name": "phonepe"},
        },
    )
    assert init2.status_code == 201
    txn2 = init2.json()["transaction_id"]

    # Stock is re-reserved (-2)
    assert client.get("/api/v1/store/products/STK-006").json()["stock_quantity"] == initial_stock - 2

    # Complete payment on retry
    otp2 = client.post(f"/api/v1/payments/{txn2}/send-otp").json()["simulated_otp"]
    client.post(f"/api/v1/payments/{txn2}/verify-otp", json={"otp": otp2})
    proc2 = client.post(f"/api/v1/payments/{txn2}/process", json={"outcome": "SUCCESS"})
    assert proc2.status_code == 200

    # Final order is PAID
    final_order = client.get(f"/api/v1/store/orders/{order_id}", headers={"X-Order-Token": order_token}).json()
    assert final_order["status"] == "PAID"
    # Final stock remains deducted
    assert client.get("/api/v1/store/products/STK-006").json()["stock_quantity"] == initial_stock - 2
