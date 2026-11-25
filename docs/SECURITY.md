# Security Architecture & Controls

> **Disclaimer**: This application is an educational full-stack simulation built for automated testing with Playwright and Pytest. It does **not** process real money or integrate with live card/banking networks.

---

## 1. Sensitive Financial Data Handling
- Simulated card numbers, CVV codes, and expiry dates are validated in Pydantic schemas (`backend/app/schemas/payment.py`) during payment initiation and are **never persisted** in PostgreSQL (`payment_transactions`) or returned in API responses/logs.
- Customer emails returned in `GET /api/v1/payments/{transaction_id}` and `GET /api/v1/payments` are masked via `mask_customer_email()`.

## 2. Cryptographic OTP Lifecycle (`backend/app/services/otp_service.py`)
- **CSPRNG Generation**: 6-digit OTPs are generated using Python's `secrets` module.
- **Keyed Hashing Only**: Plaintext OTPs are never written to the database; only HMAC-SHA256 digests keyed with `OTP_SECRET_KEY` and bound to `transaction_id` are stored in `otp_hash`.
- **Constant-Time Comparison**: Verification uses `hmac.compare_digest()`.
- **Expiry & Attempt Lockout**:
  - OTP expires after `OTP_EXPIRY_MINUTES` (`5` minutes default). Attempting to verify an expired OTP transitions the transaction to `FAILED`.
  - Maximum `OTP_MAX_ATTEMPTS` (`3` attempts): 3 incorrect submissions lock verification and transition the transaction to `FAILED`.
  - Resending invalidates the previous OTP, enforces `OTP_RESEND_COOLDOWN_SECONDS` (`30s`), and caps total resends at `OTP_MAX_RESENDS` (`3`).
  - Finalized transactions have `otp_hash` cleared (`NULL`).

## 3. Server-Side Price & Stock Integrity (`backend/app/services/store_service.py`)
- Frontend prices and totals are **never trusted**. `POST /api/v1/store/orders` accepts only `product_id` and `quantity`, reads authoritative unit prices from PostgreSQL `store_products`, computes `delivery_fee` (`0.0` if subtotal `>= 499.0`, else `50.0`), and computes `total_amount` on the server.
- Row-level locking (`SELECT ... FOR UPDATE`) prevents race conditions when decrementing `stock_quantity` on order creation or restoring/re-reserving stock on payment failure/retry.
- Payment initiation (`prepare_store_order_for_payment`) rejects mismatched/tampered frontend amounts with `HTTP 400 Bad Request` and rejects payments for already-`PAID` orders with `HTTP 409 Conflict`.

## 4. Order Ownership Access Controls
- Each created store order generates a random `secrets.token_urlsafe(32)` access token (`order_token`), storing only its keyed HMAC-SHA256 hash (`order_token_hash`) in `store_orders`.
- `GET /api/v1/store/orders/{order_id}` validates `X-Order-Token` / `?token=` via constant-time HMAC comparison, returning `401 Unauthorized` when missing and `403 Forbidden` when invalid.

## 5. Idempotency & Duplicate Prevention
- **Checkout UI**: Synchronous `useRef` submit lock (`submitLockRef`) + disabled button loading state prevent duplicate order creation on rapid double-clicks.
- **Payment Gateway**: `POST /api/v1/payments/initiate` and `POST /api/v1/payments/{id}/process` support `Idempotency-Key` headers and enforce strict state machine transitions (`PENDING -> AUTHENTICATED -> PROCESSING -> SUCCESS / DECLINED / FAILED`), returning `409 Conflict` for duplicate processing on terminal transactions.

## 6. Production vs. Development Controls
When `ENVIRONMENT=production` (verified in `backend/tests/test_security_audit.py`):
- `simulated_otp` is omitted (`null`) from `/send-otp` and `/resend-otp` responses.
- Outcome overrides (`outcome` query/body parameters and `SIMULATE DECLINE` / `SIMULATE FAIL` triggers) are blocked server-side with `HTTP 403 Forbidden` / `400 Bad Request`.
- `X-Test-Clock-Offset` testing headers are ignored.

## 7. Known Security Limitations (Pre-Production)
- **No User Accounts / Session Auth**: Customer storefront browsing and `/api/v1/payments` history listing are unauthenticated for local demo/testing convenience. Before any production deployment, add user authentication, RBAC/JWT authorization on transaction history endpoints, HTTPS/TLS termination, and CSRF/rate-limiting middleware.
- **Historical Example Key Rotation**: An earlier commit (`75b7569`) included a static placeholder value (`juspay_sec_hmac_key_2026_audit_challenge_key`) in `.env.example`. Although `.env` was never committed and `.env.example` has been sanitized to placeholders, any shared or live deployment must generate a fresh random `OTP_SECRET_KEY`.
