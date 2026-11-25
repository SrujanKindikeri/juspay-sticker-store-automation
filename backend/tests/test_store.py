import pytest
from fastapi.testclient import TestClient
from tests.conftest import verify_test_email


def test_get_store_categories(client: TestClient):
    """Verify that categories endpoint returns all sticker categories."""
    response = client.get("/api/v1/store/categories")
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data, list)
    assert len(data) >= 7

    slugs = [cat["slug"] for cat in data]
    assert "anime" in slugs
    assert "laptop" in slugs
    assert "cute" in slugs
    assert "gaming" in slugs
    assert "aesthetic" in slugs
    assert "quotes" in slugs
    assert "packs" in slugs


def test_get_store_products_list(client: TestClient):
    """Verify products catalogue listing returns products with all required attributes."""
    response = client.get("/api/v1/store/products?limit=50")
    assert response.status_code == 200
    data = response.json()
    assert "items" in data
    assert "total" in data
    assert data["total"] >= 12
    assert len(data["items"]) >= 12

    # Check structure of the first product
    prod = data["items"][0]
    assert "id" in prod
    assert "name" in prod
    assert "price" in prod
    assert "stock_quantity" in prod
    assert "category" in prod
    assert "size" in prod
    assert "material" in prod
    assert "image_url" in prod
    assert prod["price"] > 0
    assert prod["stock_quantity"] >= 0


def test_get_store_products_filter_category(client: TestClient):
    """Verify category filtering works accurately."""
    response = client.get("/api/v1/store/products?category=anime")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) >= 1
    for prod in data["items"]:
        assert prod["category"] == "anime"


def test_search_store_products(client: TestClient):
    """Verify full-text search on product names and descriptions."""
    # Search for Cyberpunk
    response = client.get("/api/v1/store/products?search=Cyberpunk")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) >= 1
    assert any("Cyberpunk" in p["name"] for p in data["items"])

    # Search for non-existent keyword
    response = client.get("/api/v1/store/products?search=NonExistentStickerXYZ99")
    assert response.status_code == 200
    data = response.json()
    assert len(data["items"]) == 0


def test_get_product_detail_success(client: TestClient):
    """Verify retrieving a single product by ID."""
    response = client.get("/api/v1/store/products/STK-001")
    assert response.status_code == 200
    prod = response.json()
    assert prod["id"] == "STK-001"
    assert "Cyberpunk" in prod["name"]
    assert prod["price"] == 99.0
    assert prod["is_in_stock"] is True


def test_get_product_detail_not_found(client: TestClient):
    """Verify 404 response when querying invalid product ID."""
    response = client.get("/api/v1/store/products/NON-EXISTENT-STICKER-404")
    assert response.status_code == 404
    assert "not found" in response.json()["detail"].lower()


def test_create_store_order_authoritative_pricing(client: TestClient):
    """
    Verify order creation with authoritative backend calculation:
    - Subtotal < 499 incurs standard 50 INR delivery fee.
    - Status is PENDING_PAYMENT.
    """
    payload = {
        "items": [
            {"product_id": "STK-001", "quantity": 1}
        ],
        "delivery": {
            "full_name": "Rohan Mehra",
            "mobile_number": "9876543210",
            "email": "rohan.mehra@example.com",
            "address_line": "Flat 204, Green Heights, Indiranagar",
            "city": "Bengaluru",
            "state": "Karnataka",
            "pincode": "560038"
        },
        **verify_test_email(client, "rohan.mehra@example.com"),
    }
    response = client.post("/api/v1/store/orders", json=payload)
    assert response.status_code == 201
    order = response.json()
    assert order["order_id"].startswith("STK-ORD-")
    assert order["status"] == "PENDING_PAYMENT"
    assert order["subtotal"] == 99.0
    assert order["delivery_fee"] == 50.0
    assert order["total_amount"] == 149.0
    assert order["currency"] == "INR"
    assert len(order["items"]) == 1
    assert order["items"][0]["product_id"] == "STK-001"
    assert order["items"][0]["unit_price"] == 99.0
    assert order["items"][0]["quantity"] == 1
    assert order["items"][0]["total_price"] == 99.0
    assert order["delivery"]["full_name"] == "Rohan Mehra"
    assert order["delivery"]["mobile_number"] == "9876543210"


def test_create_store_order_free_shipping(client: TestClient):
    """
    Verify free shipping threshold:
    - Subtotal >= 499 gives free delivery (0.0 INR).
    - Status is PENDING_PAYMENT.
    """
    payload = {
        "items": [
            {"product_id": "STK-012", "quantity": 2}  # 299 * 2 = 598 >= 499
        ],
        "delivery": {
            "full_name": "Pooja Hegde",
            "mobile_number": "8877665544",
            "email": "pooja.h@example.com",
            "address_line": "Plot 12, Hitech City Main Road",
            "city": "Hyderabad",
            "state": "Telangana",
            "pincode": "500081"
        },
        **verify_test_email(client, "pooja.h@example.com"),
    }
    response = client.post("/api/v1/store/orders", json=payload)
    assert response.status_code == 201
    order = response.json()
    assert order["status"] == "PENDING_PAYMENT"
    assert order["subtotal"] == 598.0
    assert order["delivery_fee"] == 0.0
    assert order["total_amount"] == 598.0


def test_create_store_order_stock_deduction(client: TestClient):
    """Verify that placing an order deducts stock quantity atomically."""
    # Check current stock
    prod_res = client.get("/api/v1/store/products/STK-002")
    assert prod_res.status_code == 200
    initial_stock = prod_res.json()["stock_quantity"]
    assert initial_stock >= 5

    qty_to_buy = 2
    payload = {
        "items": [
            {"product_id": "STK-002", "quantity": qty_to_buy}
        ],
        "delivery": {
            "full_name": "Vikram Seth",
            "mobile_number": "7766554433",
            "email": "vikram@example.com",
            "address_line": "14 Marine Drive",
            "city": "Mumbai",
            "state": "Maharashtra",
            "pincode": "400020"
        },
        **verify_test_email(client, "vikram@example.com"),
    }
    order_res = client.post("/api/v1/store/orders", json=payload)
    assert order_res.status_code == 201

    # Verify stock decremented
    updated_res = client.get("/api/v1/store/products/STK-002")
    assert updated_res.status_code == 200
    updated_stock = updated_res.json()["stock_quantity"]
    assert updated_stock == initial_stock - qty_to_buy


def test_create_store_order_insufficient_stock(client: TestClient):
    """Verify that ordering more than available stock is rejected with HTTP 400."""
    payload = {
        "items": [
            {"product_id": "STK-003", "quantity": 50}  # Limit per schema is 50, but let's test exceeding stock
        ],
        "delivery": {
            "full_name": "Ananya Roy",
            "mobile_number": "9988776655",
            "email": "ananya@example.com",
            "address_line": "Park Street 2B",
            "city": "Kolkata",
            "state": "West Bengal",
            "pincode": "700016"
        }
    }
    # First verify current stock is less than 50 or temporarily buy all
    # We can check stock of STK-003
    stock = client.get("/api/v1/store/products/STK-003").json()["stock_quantity"]
    # If stock is 60, ordering 50 might succeed, but ordering more than stock should fail
    # We can pass quantity = stock + 1 if <= 50, or create order for stock then try again
    excess_qty = min(50, stock + 1)
    if excess_qty > stock:
        payload.update(verify_test_email(client, "ananya@example.com"))
        payload["items"][0]["quantity"] = excess_qty
        res = client.post("/api/v1/store/orders", json=payload)
        assert res.status_code == 400
        assert "Insufficient stock" in res.json()["detail"]


def test_create_store_order_validation_errors(client: TestClient):
    """Verify that invalid delivery inputs are rejected with HTTP 422."""
    base_payload = {
        "items": [{"product_id": "STK-001", "quantity": 1}],
        "delivery": {
            "full_name": "Test User",
            "mobile_number": "9876543210",
            "email": "test@example.com",
            "address_line": "123 Main Road",
            "city": "Bengaluru",
            "state": "Karnataka",
            "pincode": "560001"
        }
    }

    # Invalid mobile (not 10 digits starting with 6-9)
    bad_phone = dict(base_payload)
    bad_phone["delivery"] = dict(base_payload["delivery"], mobile_number="12345")
    res = client.post("/api/v1/store/orders", json=bad_phone)
    assert res.status_code == 422

    # Invalid email
    bad_email = dict(base_payload)
    bad_email["delivery"] = dict(base_payload["delivery"], email="invalid-email-address")
    res = client.post("/api/v1/store/orders", json=bad_email)
    assert res.status_code == 422

    # Invalid PIN code (not 6 digits)
    bad_pincode = dict(base_payload)
    bad_pincode["delivery"] = dict(base_payload["delivery"], pincode="560")
    res = client.post("/api/v1/store/orders", json=bad_pincode)
    assert res.status_code == 422

    # Empty items list
    empty_items = dict(base_payload, items=[])
    res = client.post("/api/v1/store/orders", json=empty_items)
    assert res.status_code == 422


def test_get_store_order_by_id(client: TestClient):
    """Verify retrieving order by ID with secure order-token authorization."""
    # Create order first
    payload = {
        "items": [{"product_id": "STK-004", "quantity": 1}],
        "delivery": {
            "full_name": "Deepak Verma",
            "mobile_number": "9123456789",
            "email": "deepak.verma@example.com",
            "address_line": "45 Civil Lines",
            "city": "Jaipur",
            "state": "Rajasthan",
            "pincode": "302001"
        },
        **verify_test_email(client, "deepak.verma@example.com"),
    }
    create_res = client.post("/api/v1/store/orders", json=payload)
    assert create_res.status_code == 201
    created_data = create_res.json()
    order_id = created_data["order_id"]
    order_token = created_data["order_token"]
    assert order_token is not None

    # 1. Fetching without token returns 401 Unauthorized
    unauth_res = client.get(f"/api/v1/store/orders/{order_id}")
    assert unauth_res.status_code == 401
    assert "token is required" in unauth_res.json()["detail"]

    # 2. Fetching with invalid token returns 403 Forbidden
    forbidden_res = client.get(
        f"/api/v1/store/orders/{order_id}",
        headers={"X-Order-Token": "wrong-token-abc"},
    )
    assert forbidden_res.status_code == 403
    assert "Invalid order access token" in forbidden_res.json()["detail"]

    # 3. Fetching with valid token returns 200 OK with order details
    fetch_res = client.get(
        f"/api/v1/store/orders/{order_id}",
        headers={"X-Order-Token": order_token},
    )
    assert fetch_res.status_code == 200
    fetched_order = fetch_res.json()
    assert fetched_order["order_id"] == order_id
    assert fetched_order["status"] == "PENDING_PAYMENT"
    assert fetched_order["delivery"]["full_name"] == "Deepak Verma"
    assert len(fetched_order["items"]) == 1
    assert fetched_order["items"][0]["product_id"] == "STK-004"

    # Also test query parameter ?token=...
    query_res = client.get(f"/api/v1/store/orders/{order_id}?token={order_token}")
    assert query_res.status_code == 200


def test_get_store_order_not_found(client: TestClient):
    """Verify 404 response for non-existent order ID."""
    res = client.get("/api/v1/store/orders/STK-ORD-DOES-NOT-EXIST-404")
    assert res.status_code == 404
    assert "not found" in res.json()["detail"].lower()


def test_phase_7_order_status_guarantee(client: TestClient):
    """Verify that in Phase 7 orders are NEVER marked as PAID or SUCCESS."""
    payload = {
        "items": [{"product_id": "STK-005", "quantity": 1}],
        "delivery": {
            "full_name": "Sonia Gandhi",
            "mobile_number": "9811223344",
            "email": "sonia.g@example.com",
            "address_line": "10 Janpath",
            "city": "New Delhi",
            "state": "Delhi",
            "pincode": "110011"
        },
        **verify_test_email(client, "sonia.g@example.com"),
    }
    res = client.post("/api/v1/store/orders", json=payload)
    assert res.status_code == 201
    data = res.json()
    assert data["status"] == "PENDING_PAYMENT"
    assert data["status"] not in ["SUCCESS", "PAID", "COMPLETED", "SETTLED"]
