import json
import pytest
from fastapi.testclient import TestClient
from tests.conftest import verify_test_email
from app.services.paytm_service import (
    generate_paytm_signature,
    verify_paytm_signature,
    get_paytm_checkout_js_url,
)
from app.core.config import settings


TEST_MERCHANT_KEY = "mock_stage_key_12345678"


def test_paytm_checksum_generation_and_verification():
    """
    Verify Paytm checksum generation and verification:
    - Valid signature verifies True.
    - Tampered payload fails verification (False).
    - Invalid signature fails verification (False).
    """
    payload = {
        "mid": "TEST_MID_001",
        "orderId": "ORD_TEST_999",
        "txnAmount": {"value": "149.00", "currency": "INR"},
    }

    signature = generate_paytm_signature(payload, merchant_key=TEST_MERCHANT_KEY)
    assert signature is not None
    assert len(signature) > 10

    # 1. Valid verification
    assert verify_paytm_signature(payload, signature, merchant_key=TEST_MERCHANT_KEY) is True

    # 2. Tampered payload fails verification
    tampered = payload.copy()
    tampered["txnAmount"] = {"value": "1.00", "currency": "INR"}
    assert verify_paytm_signature(tampered, signature, merchant_key=TEST_MERCHANT_KEY) is False

    # 3. Invalid signature string fails verification
    assert verify_paytm_signature(payload, "invalid_sig_xyz", merchant_key=TEST_MERCHANT_KEY) is False


def test_paytm_checkout_js_url():
    """Verify official checkoutjs URL resolves correctly to staging."""
    url = get_paytm_checkout_js_url()
    assert "checkoutjs/merchants" in url
    assert "https://securegw-stage.paytm.in" in url


def test_paytm_config_endpoint(client: TestClient):
    """Verify GET /api/v1/payments/paytm/config returns provider metadata."""
    res = client.get("/api/v1/payments/paytm/config")
    assert res.status_code == 200
    data = res.json()
    assert "provider" in data
    assert "environment" in data
    assert "checkout_js_url" in data


def test_paytm_initiate_transaction(client: TestClient):
    """
    Verify POST /api/v1/payments/paytm/initiate:
    - Creates store order.
    - Successfully calls initiate endpoint.
    - Returns txn_token, mid, callback_url, order_id, amount.
    """
    # 1. Create a store order
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],  # 99 + 50 = 149.0
            "delivery": {
                "full_name": "Paytm Customer",
                "mobile_number": "9876543210",
                "email": "paytm_cust@example.com",
                "address_line": "MG Road 45",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
            **verify_test_email(client, "paytm_cust@example.com"),
        },
    )
    assert order_res.status_code == 201
    order_data = order_res.json()
    order_id = order_data["order_id"]

    # 2. Initiate Paytm payment
    pay_res = client.post(
        "/api/v1/payments/paytm/initiate",
        json={
            "order_id": order_id,
            "amount": 149.0,
            "currency": "INR",
            "customer_email": "paytm_cust@example.com",
        },
    )
    assert pay_res.status_code == 201
    pay_data = pay_res.json()
    assert pay_data["order_id"] == order_id
    assert pay_data["amount"] == 149.0
    assert pay_data["txn_token"] is not None
    assert pay_data["status"] == "PENDING"
    assert "callback_url" in pay_data


def test_paytm_initiate_tampered_amount_rejected(client: TestClient):
    """
    Verify that initiating Paytm payment with tampered amount is rejected with HTTP 400.
    """
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": {
                "full_name": "Tamper Tester",
                "mobile_number": "9876543210",
                "email": "tamper@example.com",
                "address_line": "MG Road 45",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
            **verify_test_email(client, "tamper@example.com"),
        },
    )
    assert order_res.status_code == 201
    order_id = order_res.json()["order_id"]

    # Attempt to pay 5.00 INR instead of 149.00 INR
    pay_res = client.post(
        "/api/v1/payments/paytm/initiate",
        json={
            "order_id": order_id,
            "amount": 5.0,
            "currency": "INR",
            "customer_email": "tamper@example.com",
        },
    )
    assert pay_res.status_code == 400
    assert "Tampered amount rejected" in pay_res.json()["detail"]


def test_paytm_callback_success_updates_store_order(client: TestClient):
    """
    Verify Paytm callback processing for successful transaction:
    - PaymentTransaction marked SUCCESS.
    - StoreOrder marked PAID.
    - Stock permanently consumed.
    """
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": {
                "full_name": "Success User",
                "mobile_number": "9876543210",
                "email": "success@example.com",
                "address_line": "Indiranagar 12",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560038",
            },
            **verify_test_email(client, "success@example.com"),
        },
    )
    assert order_res.status_code == 201, f"Order creation failed: {order_res.text}"
    order_data = order_res.json()
    order_id = order_data["order_id"]

    # Initiate
    client.post(
        "/api/v1/payments/paytm/initiate",
        json={"order_id": order_id, "amount": 149.0, "currency": "INR"},
    )

    # Simulate Gateway Callback
    callback_payload = {
        "ORDERID": order_id,
        "TXNID": "PTM_GATEWAY_SUCCESS_01",
        "TXNAMOUNT": "149.00",
        "STATUS": "TXN_SUCCESS",
        "RESPCODE": "01",
        "RESPMSG": "Txn Success",
        "CHECKSUMHASH": "MOCK_VALID_CHECKSUM",
    }
    cb_res = client.post("/api/v1/payments/paytm/callback", json=callback_payload)
    assert cb_res.status_code == 200
    cb_data = cb_res.json()
    assert cb_data["payment_status"] == "SUCCESS"
    assert cb_data["store_order_status"] == "PAID"

    # Query status endpoint
    status_res = client.get(f"/api/v1/payments/paytm/status/{order_id}")
    assert status_res.status_code == 200
    assert status_res.json()["status"] == "SUCCESS"
    assert status_res.json()["store_order_status"] == "PAID"


def test_paytm_callback_failure_updates_store_order_and_restores_stock(client: TestClient):
    """
    Verify Paytm callback processing for failed transaction:
    - PaymentTransaction marked FAILED.
    - StoreOrder marked PAYMENT_FAILED.
    - Stock restored.
    """
    # Check initial stock
    p_before = client.get("/api/v1/store/products/STK-001").json()["stock_quantity"]

    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 2}],
            "delivery": {
                "full_name": "Fail User",
                "mobile_number": "9876543210",
                "email": "fail@example.com",
                "address_line": "MG Road 10",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560001",
            },
            **verify_test_email(client, "fail@example.com"),
        },
    )
    assert order_res.status_code == 201, f"Order creation failed: {order_res.text}"
    order_id = order_res.json()["order_id"]

    # Stock should be reduced by 2
    p_during = client.get("/api/v1/store/products/STK-001").json()["stock_quantity"]
    assert p_during == p_before - 2

    # Initiate
    client.post(
        "/api/v1/payments/paytm/initiate",
        json={"order_id": order_id, "amount": 248.0, "currency": "INR"},
    )

    # Callback with Failure
    callback_payload = {
        "ORDERID": order_id,
        "TXNID": "PTM_GATEWAY_FAIL_02",
        "TXNAMOUNT": "248.00",
        "STATUS": "TXN_FAILURE",
        "RESPCODE": "227",
        "RESPMSG": "Bank Declined Transaction",
        "CHECKSUMHASH": "MOCK_VALID_CHECKSUM",
    }
    cb_res = client.post("/api/v1/payments/paytm/callback", json=callback_payload)
    assert cb_res.status_code == 200
    cb_data = cb_res.json()
    assert cb_data["payment_status"] == "FAILED"
    assert cb_data["store_order_status"] == "PAYMENT_FAILED"

    # Stock should be restored
    p_after = client.get("/api/v1/store/products/STK-001").json()["stock_quantity"]
    assert p_after == p_before


def test_paytm_callback_idempotency(client: TestClient):
    """
    Verify duplicate callbacks for already finalized transactions are handled idempotently
    without errors or duplicate stock modifications.
    """
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": {
                "full_name": "Idempotent User",
                "mobile_number": "9876543210",
                "email": "idem@example.com",
                "address_line": "Whitefield 20",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560066",
            },
            **verify_test_email(client, "idem@example.com"),
        },
    )
    assert order_res.status_code == 201, f"Order creation failed: {order_res.text}"
    order_id = order_res.json()["order_id"]

    client.post(
        "/api/v1/payments/paytm/initiate",
        json={"order_id": order_id, "amount": 149.0, "currency": "INR"},
    )

    callback_payload = {
        "ORDERID": order_id,
        "TXNID": "PTM_IDEMPOTENT_01",
        "TXNAMOUNT": "149.00",
        "STATUS": "TXN_SUCCESS",
        "RESPCODE": "01",
        "RESPMSG": "Txn Success",
        "CHECKSUMHASH": "MOCK_VALID_CHECKSUM",
    }

    # First callback
    cb1 = client.post("/api/v1/payments/paytm/callback", json=callback_payload)
    assert cb1.status_code == 200
    assert cb1.json()["payment_status"] == "SUCCESS"

    # Second identical duplicate callback
    cb2 = client.post("/api/v1/payments/paytm/callback", json=callback_payload)
    assert cb2.status_code == 200
    assert cb2.json()["payment_status"] == "SUCCESS"
    assert cb2.json()["store_order_status"] == "PAID"


def test_paytm_reconciliation_endpoint(client: TestClient):
    """
    Verify POST /api/v1/payments/paytm/reconcile/{order_id} performs S2S inquiry.
    """
    order_res = client.post(
        "/api/v1/store/orders",
        json={
            "items": [{"product_id": "STK-001", "quantity": 1}],
            "delivery": {
                "full_name": "Reconcile User",
                "mobile_number": "9876543210",
                "email": "reconcile@example.com",
                "address_line": "Koramangala 4",
                "city": "Bengaluru",
                "state": "Karnataka",
                "pincode": "560034",
            },
            **verify_test_email(client, "reconcile@example.com"),
        },
    )
    assert order_res.status_code == 201, f"Order creation failed: {order_res.text}"
    order_id = order_res.json()["order_id"]

    client.post(
        "/api/v1/payments/paytm/initiate",
        json={"order_id": order_id, "amount": 149.0, "currency": "INR"},
    )

    rec_res = client.post(f"/api/v1/payments/paytm/reconcile/{order_id}")
    assert rec_res.status_code == 200
    rec_data = rec_res.json()
    assert rec_data["order_id"] == order_id
    assert rec_data["status"] == "SUCCESS"
    assert rec_data["is_finalized"] is True
