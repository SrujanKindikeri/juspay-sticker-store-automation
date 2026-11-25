# API Documentation

Base URL (local development): `http://127.0.0.1:8001`  
Interactive Swagger UI: `http://127.0.0.1:8001/docs`  
ReDoc: `http://127.0.0.1:8001/redoc`

---

## 1. Health & Discovery

### `GET /health` (and `GET /api/v1/health`)
Checks application health and PostgreSQL connectivity.

- **Response (`200 OK`)**:
```json
{
  "status": "ok",
  "environment": "development",
  "database": "connected",
  "version": "0.1.0",
  "timestamp": "2026-11-25T11:20:00.123456"
}
```

### `GET /`
Returns service metadata and quick links to `/docs`, `/health`, and `/api/v1/payments/initiate`.

---

## 2. Store & Products

### `GET /api/v1/store/categories`
Returns all sticker product categories ordered by ID.
- **Response (`200 OK`)**: Array of `{ id, slug, name, description, icon }`.

### `GET /api/v1/store/products`
Lists sticker products with filtering and pagination.
- **Query Parameters**:
  - `category` (optional string): Filter by category slug (e.g., `gaming`, `anime`, `packs`).
  - `search` (optional string): Case-insensitive search across name, description, category, and material.
  - `featured` (optional bool), `best_seller` (optional bool), `new_arrival` (optional bool).
  - `skip` (int `>= 0`, default `0`), `limit` (int `1..100`, default `50`).
- **Response (`200 OK`)**: `{ items: ProductResponse[], total: number, categories: CategoryResponse[] }`.

### `GET /api/v1/store/products/{product_id}`
Retrieves a single sticker product by ID (e.g., `STK-001`) or slug.
- **Errors**: `404 Not Found` if product does not exist.

---

## 3. Store Orders

### `POST /api/v1/store/orders`
Validates cart items and stock, calculates authoritative prices and delivery charge (`FREE` when subtotal `>= ₹499.00`, else `₹50.00`), reserves stock atomically, and creates an order with status `PENDING_PAYMENT`.

- **Request Body (`CreateOrderRequest`)**:
```json
{
  "items": [
    { "product_id": "STK-001", "quantity": 1 }
  ],
  "delivery": {
    "full_name": "Rohan Kulkarni",
    "mobile_number": "9876543210",
    "email": "rohan@example.com",
    "address_line": "42 Indiranagar 100 Feet Road",
    "city": "Bengaluru",
    "state": "Karnataka",
    "pincode": "560038"
  }
}
```
- **Response (`201 Created`)**:
  Returns `order_id` (`STK-ORD-...`), `status` (`"PENDING_PAYMENT"`), `subtotal`, `delivery_fee`, `total_amount`, `currency`, `order_token`, `items`, `delivery`, and `created_at`.
- **Validation & Errors**:
  - `422 Unprocessable Entity`: Invalid mobile number (must be 10-digit Indian mobile starting with `6–9`), invalid email, invalid 6-digit PIN code, quantity out of bounds (`1–50`), or empty items list.
  - `404 Not Found`: Unknown `product_id`.
  - `400 Bad Request`: Insufficient stock for requested quantity.

### `GET /api/v1/store/orders/{order_id}`
Retrieves a store order, line items, and delivery address.
- **Authorization**: Requires matching `order_token` passed via `X-Order-Token` header or `?token=` query parameter (verified via constant-time HMAC comparison against `order_token_hash`).
- **Errors**:
  - `401 Unauthorized`: Missing `order_token` when order is token-protected.
  - `403 Forbidden`: Invalid `order_token`.
  - `404 Not Found`: Order does not exist.

---

## 4. Payment Initiation

### `POST /api/v1/payments/initiate`
Initiates a simulated payment transaction (`CARD`, `UPI`, or `NET_BANKING`) with initial status `PENDING`.

- **Optional Header**: `Idempotency-Key` (returns existing matching transaction if replayed with identical payload; `409 Conflict` if reused with mismatched payload).
- **Request Body (`PaymentInitiateRequest`)**:
  - `order_id` (string, `1..64` chars)
  - `amount` (float `> 0`) — for `STK-ORD-...` orders, must match backend `total_amount` within `0.01` INR.
  - `currency` (string, default `"INR"`)
  - `payment_method`: `"CARD"` | `"UPI"` | `"NET_BANKING"`
  - `customer_email` (optional string)
  - Contextual object required based on `payment_method`:
    - `card_details`: `{ card_number, expiry (MM/YY), cvv (3–4 digits), card_holder }`
    - `upi_details`: `{ upi_id (user@bank), app_name? }`
    - `netbanking_details`: `{ bank_code }`
- **Response (`201 Created`)**: `{ transaction_id, payment_reference, order_id, amount, currency, payment_method, status: "PENDING", created_at }`.
- **Errors**:
  - `422 Unprocessable Entity`: Invalid/missing method details, invalid amount (`<= 0`), or empty `order_id`.
  - `400 Bad Request`: Tampered amount mismatch against store order total, or out-of-stock on retry, or production rejection of simulation test order IDs.
  - `409 Conflict`: Order is already settled (`PAID` / `SUCCESS`) or `Idempotency-Key` payload mismatch.

---

## 5. OTP Verification

### `POST /api/v1/payments/{transaction_id}/send-otp`
Generates a 6-digit OTP (`secrets`), stores only its keyed HMAC-SHA256 hash (`otp_hash`), and sets 5-minute expiration.
- **Response (`200 OK`)**: `{ transaction_id, message, masked_contact, expires_in_seconds, simulated_otp }`. (`simulated_otp` is strictly `null` when `ENVIRONMENT=production`.)

### `POST /api/v1/payments/{transaction_id}/verify-otp`
Verifies the submitted 6-digit OTP using constant-time `hmac.compare_digest`. Transitions transaction to `AUTHENTICATED` on success.
- **Optional Dev Header**: `X-Test-Clock-Offset` (seconds offset for deterministic expiry tests; ignored in production).
- **Request Body**: `{ "otp": "123456" }` (6 numeric digits).
- **Response (`200 OK`)**: `{ status: "AUTHENTICATED", message, transaction_id, payment_reference, amount, currency }`.
- **Errors**:
  - `400 Bad Request`: Wrong OTP (decrements remaining attempts; 3rd wrong attempt marks transaction `FAILED` and syncs store order to `PAYMENT_FAILED`) or expired OTP (marks transaction `FAILED`).

### `POST /api/v1/payments/{transaction_id}/resend-otp`
Issues a new OTP, invalidating any prior OTP hash. Enforces 30s cooldown and max 3 resends per transaction.
- **Errors**: `429 Too Many Requests` (cooldown active or max resends exceeded).

### `GET /api/v1/payments/{transaction_id}/otp-status`
Returns `{ transaction_id, status, attempts_remaining, resend_count, is_expired, expires_in_seconds, cooldown_remaining_seconds }`.

---

## 6. Payment Processing & Transaction Status

### `POST /api/v1/payments/{transaction_id}/process`
Processes an `AUTHENTICATED` transaction through `PROCESSING -> SUCCESS | DECLINED | FAILED`. Also synchronizes linked `store_orders` (`PAID` on `SUCCESS`; `PAYMENT_FAILED` + stock restoration on `DECLINED`/`FAILED`).
- **Optional Header**: `Idempotency-Key`.
- **Optional Body (`PaymentProcessRequest`)**: `{ "outcome": "SUCCESS" | "DECLINED" | "FAILED" }` (blocked with `403 Forbidden` when `ENVIRONMENT=production`).
- **Errors**:
  - `400 Bad Request`: Transaction is not `AUTHENTICATED`.
  - `409 Conflict`: Transaction already finalized (`SUCCESS`, `DECLINED`, or `FAILED`) without matching idempotency replay.

### `GET /api/v1/payments/{transaction_id}`
Retrieves authoritative, sanitized transaction status (`PENDING`, `AUTHENTICATED`, `PROCESSING`, `SUCCESS`, `DECLINED`, `FAILED`), `is_finalized`, masked `customer_email`, and timestamps (`created_at`, `updated_at`, `finalized_at`).

### `GET /api/v1/payments`
Paginated transaction history (`page`, `limit`, optional `status` and `payment_method` filters) sorted newest-first with masked customer emails and no sensitive fields.
