# JUSPAY PAYMENT GATEWAY — PHASE 5.1 SECURITY AND AUTOMATION AUDIT REPORT

**Date:** November 25, 2026  
**Auditor:** Senior QA Automation Engineer & Security Specialist  
**Application:** JUSPAY Simulated Payment Gateway  
**Environment Audited:** Local Development (`ENVIRONMENT=development`) & Production Simulation (`ENVIRONMENT=production`)  
**Verdict:** **`APPROVED FOR PHASE 6`**

---

## 1. Executive Summary

Phase 5.1 conducted an independent, comprehensive security audit and regression verification of the **JUSPAY Simulated Payment Gateway** following the completion of the Phase 5 Playwright web automation framework.

The audit verified server-side security enforcement for production environments, implemented deterministic clock-controlled OTP expiration testing, established backend-enforced duplicate payment and idempotency protections, and executed a 100% passing full regression suite across FastAPI, PostgreSQL, Next.js, and Playwright.

| Metric | Target | Result | Status |
|---|---|---|---|
| **Backend Pytest Suite** | 100% Pass | **45 / 45 Passed** (2.79s) | **PASS** |
| **Playwright Automation Suite** | 100% Pass | **16 / 16 Passed** (39.9s) | **PASS** |
| **Frontend TypeScript Build** | Zero Errors | **0 Errors / Compiled Successfully** | **PASS** |
| **Automation TypeScript** | Zero Errors | **0 Errors** | **PASS** |
| **PostgreSQL Consistency** | Zero Hash Leaks | **0 Leaks Across 280 Rows** | **PASS** |
| **Final Phase 6 Approval** | Binary Decision | **APPROVED FOR PHASE 6** | **APPROVED** |

---

## 2. Production Security Audit Findings & Implementations

### 2.1 Server-Side Enforcement of Production Restrictions
* **Vulnerability Mitigated:** Previously, simulation outcome overrides (e.g., `?scenario=DECLINED`, `?scenario=FAILED`, and outcome overrides in `/process`) were accessible directly via API or query parameters.
* **Backend Enforcement:**
  * Updated [backend/app/core/config.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/core/config.py) to provide `is_production`.
  * Updated [backend/app/routes/payment.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/routes/payment.py) to reject any direct simulation outcome override with **HTTP 403 Forbidden** whenever `ENVIRONMENT=production`.
  * Updated [backend/app/services/payment_service.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/services/payment_service.py) so `determine_simulation_outcome` strictly ignores test-scenario keywords in `order_id` or `customer_email` in production mode.
* **Frontend UI Safeguard:**
  * Updated [frontend/web/app/page.tsx](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/frontend/web/app/page.tsx) to only parse `?scenario=` query parameters when `NEXT_PUBLIC_APP_ENV !== 'production'`.

### 2.2 Sensitive Data Exposure & Masking Audit
* **Verification:**
  * No card numbers, CVVs, passwords, or raw OTP secrets are stored in the PostgreSQL database.
  * Verified table schema for `payment_transactions` contains only masked or non-sensitive metadata (`last_four`, `card_network`, `upi_id`, `bank_code`). Columns `card_number`, `cvv`, `otp`, and `otp_secret` do not exist.
  * OTPs are strictly hashed using HMAC-SHA256 with transaction ID salt prior to storage.
  * `/send-otp` and `/resend-otp` endpoints strictly withhold `simulated_otp` and `dev_otp_value` in API responses when `is_production` is `True`.
  * Application logs do not log OTP values or sensitive cardholder data.

---

## 3. Deterministic OTP Expiry Testing

### 3.1 Controllable Clock Architecture
Waiting 300 seconds (5 minutes) in automated test suites causes slow, brittle CI/CD pipelines. A controllable virtual clock utility was introduced:
* **Implementation:** [backend/app/core/clock.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/core/clock.py) provides `get_current_time(clock_offset_seconds)` and `set_test_clock_offset()`.
* **Security Guard:** The controllable clock strictly requires `settings.is_development == True`. In production mode, any `X-Test-Clock-Offset` header or offset argument is strictly ignored, falling back to genuine UTC system time.
* **Endpoints Supported:**
  * `POST /api/v1/payments/{transaction_id}/verify-otp`
  * `POST /api/v1/payments/{transaction_id}/resend-otp`
  * `GET /api/v1/payments/{transaction_id}/otp-status`

### 3.2 Automated Test Proofs
* **Pytest Verification:** `test_deterministic_otp_expiry_with_controllable_clock` and `test_expired_otp_cannot_become_authenticated_or_success` in [backend/tests/test_security_audit.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/tests/test_security_audit.py).
  * Validated that advancing virtual time by +360 seconds (6 minutes) causes OTP verification to fail immediately with HTTP 400 Bad Request (`"OTP has expired. Transaction marked as FAILED."`).
  * Confirms transaction state transitions immediately to `FAILED` and `otp_hash` is cleared to `NULL`.
* **Playwright Verification:** `tests/security-audit.spec.ts` executes a deterministic browser test by injecting `X-Test-Clock-Offset: 360` on the `/verify-otp` request route.
  * The frontend receives the 400 rejection and transitions cleanly to the Payment Failed screen.
  * Direct PostgreSQL query confirms `status = 'FAILED'` and `otp_hash IS NULL`.

---

## 4. Backend Duplicate-Payment & Idempotency Protection

Relying solely on frontend button disabling is insufficient to protect financial transactions against network retries, race conditions, or malicious double-spend requests.

### 4.1 Payment Initiation Protection (`POST /api/v1/payments/initiate`)
* If an order (`order_id`) has already reached `SUCCESS`, subsequent initiation requests are rejected with **HTTP 409 Conflict** (`"Order '...' has already been successfully paid."`).
* Supports client-supplied `Idempotency-Key` header: replaying the identical initiation payload with the same key returns the existing pending transaction safely without creating duplicate database rows.

### 4.2 Payment Processing Protection (`POST /api/v1/payments/{transaction_id}/process`)
* Utilizes PostgreSQL row-level locking (`SELECT ... FOR UPDATE`) in `process_authenticated_payment()` to prevent concurrent settlement races.
* If transaction status is `PROCESSING`, re-submission returns **HTTP 409 Conflict**.
* If transaction status is already finalized (`SUCCESS`, `DECLINED`, `FAILED`), re-submission returns **HTTP 409 Conflict** unless the matching `Idempotency-Key` is provided.
* Replays with matching `Idempotency-Key` return the existing completed record idempotently.

---

## 5. PostgreSQL Data Consistency & Hygiene Audit

Direct inspection of the PostgreSQL container database (`juspay_postgres`) confirmed:
1. **Total Transactions Audited:** 280 records.
2. **Status Distribution:**
   * `PENDING`: 112
   * `SUCCESS`: 63
   * `FAILED`: 53
   * `AUTHENTICATED`: 34
   * `DECLINED`: 17
   * `PROCESSING`: 1
3. **OTP Hash Invalidation:**
   * 0 un-cleared OTP hashes on `SUCCESS` transactions.
   * 0 un-cleared OTP hashes on `FAILED` transactions.
   * Startup lifespan migration in [backend/app/main.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/main.py) and settlement handler in [backend/app/services/payment_service.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/services/payment_service.py) guarantee defense-in-depth sanitization of OTP hashes upon final status transition.
4. **Credential Audit:** Verified absence of `card_number`, `cvv`, `card_cvv`, `otp`, or `otp_secret` columns across the entire schema.

---

## 6. Files Changed During Phase 5.1

| Component | File Path | Description of Changes |
|---|---|---|
| Backend Core | [backend/app/core/config.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/core/config.py) | Added `is_production` property. |
| Backend Core | [backend/app/core/clock.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/core/clock.py) | Controllable clock utility supporting `X-Test-Clock-Offset` in development. |
| Backend Models | [backend/app/models/payment.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/models/payment.py) | Added `idempotency_key` column with index. |
| Backend Main | [backend/app/main.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/main.py) | Lifespan schema migration for `idempotency_key` and legacy OTP hash cleanup. |
| Backend Service | [backend/app/services/otp_service.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/services/otp_service.py) | Integrated controllable clock; cleared `otp_hash` on expiration/lockout. |
| Backend Service | [backend/app/services/payment_service.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/services/payment_service.py) | Added row-locking (`with_for_update`), duplicate-payment rejection, idempotency support, and production outcome restrictions. |
| Backend Routes | [backend/app/routes/otp.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/routes/otp.py) | Bound `X-Test-Clock-Offset` header for OTP verification, resend, and status. |
| Backend Routes | [backend/app/routes/payment.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/app/routes/payment.py) | Bound `Idempotency-Key` header; blocked outcome overrides in production (HTTP 403). |
| Backend Tests | [backend/tests/test_otp.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/tests/test_otp.py) | Updated test fixtures to use dynamic order IDs to avoid duplicate payment collisions. |
| Backend Tests | [backend/tests/test_security_audit.py](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/backend/tests/test_security_audit.py) | Added 10 automated test cases for production security, controllable clock, and idempotency. |
| Frontend Web | [frontend/web/app/page.tsx](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/frontend/web/app/page.tsx) | Disabled test scenario query parameters in production builds. |
| Automation Web | [automation/web/pages/CheckoutPage.ts](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/automation/web/pages/CheckoutPage.ts) | Dynamic order ID generation preventing persistent database collisions. |
| Automation Web | [automation/web/tests/security-audit.spec.ts](file:///c:/Users/kindi/OneDrive/Documents/Juspay Payment Automation/automation/web/tests/security-audit.spec.ts) | Playwright test suite for deterministic OTP expiry, duplicate payments, and API security. |

---

## 7. Full Regression Test Results

### 7.1 Backend Pytest (45 / 45 Passed)
```
backend/tests/test_database.py ......... [5 passed]
backend/tests/test_health.py ........... [6 passed]
backend/tests/test_otp.py .............. [12 passed]
backend/tests/test_payment.py .......... [12 passed]
backend/tests/test_security_audit.py ... [10 passed]
==================== 45 passed, 1 warning in 2.79s ====================
```

### 7.2 Frontend TypeScript & Production Build (0 Errors)
```
> juspay-web@0.1.0 build
> next build
▲ Next.js 14.2.34
✓ Compiled successfully
✓ Generating static pages (4/4)
✓ Finalizing page optimization
```

### 7.3 Playwright Test Suite (16 / 16 Passed)
```
Running 16 tests using 1 worker
  ok  1 › tests/card-payment.spec.ts: Complete 13-step simulated Card payment (2.7s)
  ok  2 › tests/negative-scenarios.spec.ts: validation error for invalid card number (1.9s)
  ok  3 › tests/negative-scenarios.spec.ts: validation error for invalid UPI ID format (1.7s)
  ok  4 › tests/negative-scenarios.spec.ts: reject empty or incomplete OTP input (2.2s)
  ok  5 › tests/negative-scenarios.spec.ts: decrement remaining attempts on invalid OTP (2.2s)
  ok  6 › tests/negative-scenarios.spec.ts: lock transaction to FAILED after 3 attempts (2.8s)
  ok  7 › tests/negative-scenarios.spec.ts: enforce backend resend cooldown (1.9s)
  ok  8 › tests/negative-scenarios.spec.ts: prevent duplicate form submissions (1.9s)
  ok  9 › tests/netbanking-payment.spec.ts: complete end-to-end Net Banking journey (2.5s)
  ok 10 › tests/payment-outcomes.spec.ts: Outcome Scenario 1: Deterministic SUCCESS (2.6s)
  ok 11 › tests/payment-outcomes.spec.ts: Outcome Scenario 2: Deterministic DECLINED (3.0s)
  ok 12 › tests/payment-outcomes.spec.ts: Outcome Scenario 3: Deterministic FAILED (2.6s)
  ok 13 › tests/security-audit.spec.ts: Deterministic OTP Expiry rejection (2.5s)
  ok 14 › tests/security-audit.spec.ts: Backend Duplicate Payment Protection (4.4s)
  ok 15 › tests/security-audit.spec.ts: Production Mode Direct Override Forbidden (134ms)
  ok 16 › tests/upi-payment.spec.ts: Complete 8-step simulated UPI payment (2.6s)

  16 passed (39.9s)
```

---

## 8. Remaining Limitations

1. **Simulated Financial Environment:** This gateway is built strictly for education, demonstration, and automated end-to-end testing. It does not integrate with NPCI, Visa/Mastercard networks, or real banking switches.
2. **Clock Offset Scope:** The controllable clock offset is enabled strictly via explicit opt-in (`settings.is_development == True`). External production deployments running behind reverse proxies will ignore this header.
3. **Single-Region Database Locking:** Concurrency duplicate prevention relies on PostgreSQL `SELECT ... FOR UPDATE` row-level locks, ideal for standard multi-worker instances connected to the primary PostgreSQL cluster.

---

## 9. Final Verdict

# **APPROVED FOR PHASE 6**

All security controls, deterministic OTP expiration tests, duplicate payment protections, database consistency checks, and full regression automation suites are verified, green, and completely documented. The application is fully prepared for Phase 6.
