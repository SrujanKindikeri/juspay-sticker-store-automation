# Testing Guide — Juspay Sticker Store Automation

This guide documents all automated verification suites in the repository and how to run them on Windows PowerShell.

---

## 1. Prerequisites for Testing
Ensure PostgreSQL (`juspay_postgres` on port `5433`) is running and `.env` is configured from `.env.example`:
```powershell
docker compose up -d
docker compose ps
```

---

## 2. Backend Pytest Suite (`backend/tests/`)

The backend suite executes **77 automated tests** across 8 test modules using FastAPI `TestClient` and PostgreSQL:
- `test_database.py` (5 tests): PostgreSQL dialect, `SELECT 1`, session lifecycle, OpenAPI `/docs` and `/redoc`.
- `test_health.py` (6 tests): `/health`, `/api/v1/health`, `/`, CORS headers, DB connected/disconnected handling.
- `test_payment.py` (12 tests): Card/UPI/Net Banking initiation, contextual validation, invalid inputs.
- `test_otp.py` (12 tests): OTP generation, keyed HMAC-SHA256 verification, 5-minute expiry, 3-attempt lockout, resend cooldown (`30s`), max resends (`3`), production mode OTP hiding.
- `test_security_audit.py` (10 tests): Production-mode blocking of simulation overrides, controllable clock expiry, duplicate payment prevention, `Idempotency-Key` enforcement.
- `test_lifecycle_management.py` (11 tests): State transitions (`PENDING -> AUTHENTICATED -> PROCESSING -> SUCCESS / DECLINED / FAILED`), pagination, filtering, sanitized status/history responses.
- `test_store.py` (14 tests): Categories, products, search/filtering, authoritative backend pricing, free shipping threshold (`₹499`), stock reservation, validation errors, `PENDING_PAYMENT` creation guarantee.
- `test_store_payment_integration.py` (7 tests): Store order payment initiation, tampered amount rejection (`400`), `PAID` sync on `SUCCESS`, duplicate payment blocking (`409`), stock restoration on `DECLINED`/`FAILED`, safe retry flow.

**Run Backend Tests:**
```powershell
cd backend
.\venv\Scripts\pytest.exe -v tests
```

---

## 3. Frontend TypeScript & Production Build Checks (`frontend/web/`)

```powershell
cd frontend\web
npx tsc --noEmit
npm run build
```

---

## 4. Playwright Browser Automation Suite (`automation/web/`)

The Playwright suite executes **59 end-to-end Chromium tests** (`workers: 1`, base URL `http://localhost:3001`) verifying both the UI and PostgreSQL persistence (`store_orders`, `store_order_items`, `store_customer_deliveries`, `store_products`, `payment_transactions`):

| Spec File | Tests | Coverage |
| :--- | :---: | :--- |
| `card-payment.spec.ts` | 1 | 13-step Card payment + OTP + DB verification |
| `upi-payment.spec.ts` | 1 | 8-step UPI payment + OTP + DB verification |
| `netbanking-payment.spec.ts` | 1 | Net Banking flow + bank selection + DB verification |
| `payment-outcomes.spec.ts` | 3 | Deterministic `SUCCESS`, `DECLINED`, `FAILED` outcomes |
| `negative-scenarios.spec.ts` | 7 | Invalid Card/UPI/OTP, 3-attempt lockout, cooldown, loading guard |
| `security-audit.spec.ts` | 3 | Clock-offset OTP expiry, duplicate payment prevention, prod override rejection |
| `lifecycle-management.spec.ts` | 6 | Result screen integrity, reload recovery, `409` anti-reprocess |
| `sticker-store.spec.ts` | 8 | Stickora branding, catalogue/search, details, cart, shipping, checkout |
| `cart-ui-redesign.spec.ts` | 8 | Desktop 2-col & mobile layout, empty cart, steppers, stock limits |
| `place-order-button.spec.ts` | 7 | Place Order loading, DB persistence, missing fields, OOS, offline, double-click, refresh |
| `stickora-upgrade.spec.ts` | 2 | Stickora checkout thumbnails, receipt download, Pending screen |
| `store-payment-integration.spec.ts` | 12 | Full Card/UPI/NetBanking store checkout, OTP expiry, stock restore, retry, `401`/`403`/`409`/`400`, reload |

**Run Playwright Checks & Suite (with backend on `:8001` and frontend on `:3001` running):**
```powershell
cd automation\web

# TypeScript check
npx tsc --noEmit

# Full suite (59 tests)
npx playwright test --reporter=list

# View HTML report
npx playwright show-report
```
