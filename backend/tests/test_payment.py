from fastapi.testclient import TestClient
from sqlalchemy.orm import Session
from app.database.session import SessionLocal
from app.models.payment import PaymentTransaction


def test_card_payment_initiation_success(client: TestClient):
    """Test successful card payment initiation returns HTTP 201 with PENDING status."""
    payload = {
        "order_id": "DEMO-ORD-1001",
        "amount": 999.00,
        "currency": "INR",
        "payment_method": "CARD",
        "card_details": {
            "card_number": "4111 2222 3333 4444",
            "expiry": "12/28",
            "cvv": "123",
            "card_holder": "ALEX TESTER",
        },
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 201
    data = response.json()

    assert data["order_id"] == "DEMO-ORD-1001"
    assert data["amount"] == 999.00
    assert data["currency"] == "INR"
    assert data["payment_method"] == "CARD"
    assert data["status"] == "PENDING"
    assert data["transaction_id"].startswith("TXN_")
    assert data["payment_reference"].startswith("PAY_REF_")
    assert "created_at" in data

    # Verify transaction persistence directly in PostgreSQL
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == data["transaction_id"])
            .first()
        )
        assert txn is not None
        assert txn.payment_reference == data["payment_reference"]
        assert txn.order_id == "DEMO-ORD-1001"
        assert txn.status == "PENDING"
        assert txn.amount == 999.00
    finally:
        db.close()


def test_upi_payment_initiation_success(client: TestClient):
    """Test successful UPI payment initiation."""
    payload = {
        "order_id": "DEMO-ORD-1002",
        "amount": 499.50,
        "currency": "INR",
        "payment_method": "UPI",
        "upi_details": {
            "upi_id": "tester@okaxis",
            "app_name": "gpay",
        },
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 201
    data = response.json()

    assert data["payment_method"] == "UPI"
    assert data["status"] == "PENDING"
    assert data["transaction_id"].startswith("TXN_")
    assert data["payment_reference"].startswith("PAY_REF_")

    # Verify database persistence
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.payment_reference == data["payment_reference"])
            .first()
        )
        assert txn is not None
        assert txn.payment_method == "UPI"
        assert txn.amount == 499.50
    finally:
        db.close()


def test_net_banking_payment_initiation_success(client: TestClient):
    """Test successful Net Banking payment initiation."""
    payload = {
        "order_id": "DEMO-ORD-1003",
        "amount": 1250.00,
        "currency": "INR",
        "payment_method": "NET_BANKING",
        "netbanking_details": {
            "bank_code": "HDFC",
        },
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 201
    data = response.json()

    assert data["payment_method"] == "NET_BANKING"
    assert data["status"] == "PENDING"
    assert data["amount"] == 1250.00

    # Verify database persistence
    db: Session = SessionLocal()
    try:
        txn = (
            db.query(PaymentTransaction)
            .filter(PaymentTransaction.transaction_id == data["transaction_id"])
            .first()
        )
        assert txn is not None
        assert txn.payment_method == "NET_BANKING"
    finally:
        db.close()


def test_missing_card_details_validation(client: TestClient):
    """Test validation fails when CARD is selected but card_details is missing."""
    payload = {
        "order_id": "DEMO-ORD-FAIL-1",
        "amount": 999.00,
        "payment_method": "CARD",
        # Missing card_details
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 422
    assert "card_details" in response.text


def test_invalid_card_number_validation(client: TestClient):
    """Test validation fails when card number is too short or invalid."""
    payload = {
        "order_id": "DEMO-ORD-FAIL-2",
        "amount": 999.00,
        "payment_method": "CARD",
        "card_details": {
            "card_number": "1234",  # Invalid length
            "expiry": "12/28",
            "cvv": "123",
            "card_holder": "TESTER",
        },
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 422
    assert "Invalid card number" in response.text


def test_invalid_expiry_format_validation(client: TestClient):
    """Test validation fails when card expiry format is invalid."""
    payload = {
        "order_id": "DEMO-ORD-FAIL-3",
        "amount": 999.00,
        "payment_method": "CARD",
        "card_details": {
            "card_number": "4111 2222 3333 4444",
            "expiry": "2028/12",  # Invalid format
            "cvv": "123",
            "card_holder": "TESTER",
        },
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 422
    assert "expiry" in response.text


def test_missing_upi_details_validation(client: TestClient):
    """Test validation fails when UPI is selected but upi_details is missing."""
    payload = {
        "order_id": "DEMO-ORD-FAIL-4",
        "amount": 999.00,
        "payment_method": "UPI",
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 422
    assert "upi_details" in response.text


def test_invalid_upi_id_validation(client: TestClient):
    """Test validation fails when UPI VPA is missing the @bank domain."""
    payload = {
        "order_id": "DEMO-ORD-FAIL-5",
        "amount": 999.00,
        "payment_method": "UPI",
        "upi_details": {
            "upi_id": "invalidvpa-no-at-sign",
        },
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 422
    assert "Invalid UPI ID" in response.text


def test_missing_netbanking_details_validation(client: TestClient):
    """Test validation fails when NET_BANKING is selected but bank_code is missing."""
    payload = {
        "order_id": "DEMO-ORD-FAIL-6",
        "amount": 999.00,
        "payment_method": "NET_BANKING",
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 422
    assert "netbanking_details" in response.text


def test_invalid_payment_method(client: TestClient):
    """Test validation fails when payment method is unknown or unsupported."""
    payload = {
        "order_id": "DEMO-ORD-FAIL-7",
        "amount": 999.00,
        "payment_method": "BITCOIN",  # Unsupported method
    }

    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 422


def test_invalid_negative_or_zero_amount(client: TestClient):
    """Test validation fails when amount is <= 0."""
    payload_zero = {
        "order_id": "DEMO-ORD-FAIL-8",
        "amount": 0.0,
        "payment_method": "UPI",
        "upi_details": {"upi_id": "demo@okaxis"},
    }
    res_zero = client.post("/api/v1/payments/initiate", json=payload_zero)
    assert res_zero.status_code == 422

    payload_neg = {
        "order_id": "DEMO-ORD-FAIL-9",
        "amount": -50.0,
        "payment_method": "UPI",
        "upi_details": {"upi_id": "demo@okaxis"},
    }
    res_neg = client.post("/api/v1/payments/initiate", json=payload_neg)
    assert res_neg.status_code == 422


def test_missing_order_id(client: TestClient):
    """Test validation fails when order_id is empty or missing."""
    payload = {
        "order_id": "",
        "amount": 999.00,
        "payment_method": "UPI",
        "upi_details": {"upi_id": "demo@okaxis"},
    }
    response = client.post("/api/v1/payments/initiate", json=payload)
    assert response.status_code == 422
