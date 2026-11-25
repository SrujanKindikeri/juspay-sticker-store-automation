# Stickora Store — Experimental BerryProtocol WhatsApp Integration Report

> **Experimental Status Notice:** This integration uses `berryprotocol@^0.1.10` (`@berrysdk/core`), an unofficial WhatsApp Web protocol library. It is intended for experimental merchant linking and testing only and does not carry production SLA or official WhatsApp Business API delivery guarantees.

---

## 1. Files Created and Modified

### Node.js WhatsApp Sidecar (`services/whatsapp/`)
- Created `services/whatsapp/package.json`
- Created `services/whatsapp/src/config.js`
- Created `services/whatsapp/src/WhatsAppBerryService.js`
- Created `services/whatsapp/src/server.js`
- Created `services/whatsapp/test/whatsappService.test.mjs`

### Environment & Git Exclusions
- Modified `.gitignore` (excludes `data/`, `**/data/`, `**/berry_auth/`, `**/whatsapp_session.json`, `**/berry_store.db*`, `services/**/node_modules/`, `.env`)
- Modified `.env.example` (added documented `WHATSAPP_*` variables and reset SMTP sample values to placeholders)
- Modified local untracked `.env` (added `WHATSAPP_*` variables and generated `WHATSAPP_INTERNAL_API_KEY` + `WHATSAPP_ADMIN_KEY`)

### FastAPI Backend & Pytest Suite (`backend/`)
- Created `backend/app/models/whatsapp_verification.py`
- Created `backend/app/schemas/whatsapp_verification.py`
- Created `backend/app/services/whatsapp_provider.py`
- Created `backend/app/services/whatsapp_verification_service.py`
- Created `backend/app/routes/whatsapp_admin.py`
- Created `backend/app/routes/whatsapp_verification.py`
- Created `backend/tests/test_whatsapp_integration.py`
- Modified `backend/app/core/config.py`
- Modified `backend/app/main.py`
- Modified `backend/app/models/__init__.py`
- Modified `backend/app/models/store.py`
- Modified `backend/app/schemas/store.py`
- Modified `backend/app/services/store_service.py`
- Modified `backend/app/routes/__init__.py`
- Modified `backend/app/routes/store.py`
- Modified `backend/tests/conftest.py` (disables real WhatsApp dispatch during automated Pytest runs)

### Next.js Frontend & Playwright E2E (`frontend/web/`, `automation/web/`)
- Created `frontend/web/app/admin/whatsapp/page.tsx`
- Created `automation/web/tests/whatsapp-integration.spec.ts`
- Modified `frontend/web/app/checkout/page.tsx`
- Modified `frontend/web/app/globals.css`

---

## 2. Configuration Required

Add or verify the following variables in `.env` (see `.env.example`):

| Variable | Example / Default | Purpose |
|---|---|---|
| `WHATSAPP_PROVIDER` | `berryprotocol` | Provider adapter identifier |
| `WHATSAPP_ENABLED` | `true` | Enables WhatsApp admin & verification APIs |
| `WHATSAPP_EXPERIMENTAL` | `true` | Marks integration experimental in UI/API |
| `WHATSAPP_SENDER_NAME` | `Stickora Store` | Sender name formatted in OTP messages |
| `WHATSAPP_SESSION_ID` | `stickora_berry_session` | BerryProtocol persistent session identifier |
| `WHATSAPP_SESSION_PATH` | `./data/berry_auth` | Auth credentials folder (gitignored) |
| `WHATSAPP_DATABASE_PATH` | `./data/berry_store.db` | BerryProtocol SQLite store path (gitignored) |
| `WHATSAPP_META_FILE` | `./data/whatsapp_session.json` | Non-secret session status metadata (gitignored) |
| `WHATSAPP_SERVICE_HOST` | `127.0.0.1` | Loopback bind host for Node.js sidecar |
| `WHATSAPP_SERVICE_PORT` | `8002` | Port for Node.js sidecar |
| `WHATSAPP_SERVICE_URL` | `http://127.0.0.1:8002` | FastAPI bridge target URL |
| `WHATSAPP_INTERNAL_API_KEY` | `<strong-random-secret>` | Shared FastAPI <-> sidecar `X-WhatsApp-Internal-Key` |
| `WHATSAPP_ADMIN_KEY` | `<strong-random-secret>` | Merchant `X-Admin-Key` protecting `/api/v1/admin/whatsapp/*` |
| `WHATSAPP_DISPATCH_ENABLED` | `true` (`false` in Pytest) | Prevents accidental real WhatsApp dispatch in automated tests |

---

## 3. Commands to Start the WhatsApp Service, Backend & Frontend

Ensure PostgreSQL (`:5433`) and Mailpit (`:1025` / `:8025`) Docker containers are running first, then start each service in separate terminals from the project root:

1. **Install & start the Node.js WhatsApp BerryProtocol sidecar (`127.0.0.1:8002`):**
   ```powershell
   npm --prefix services\whatsapp install
   npm --prefix services\whatsapp start
   ```
2. **Start the FastAPI backend (`127.0.0.1:8001`):**
   ```powershell
   cd backend
   .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8001
   ```
3. **Build & start the Next.js frontend (`localhost:3001`):**
   ```powershell
   npm --prefix frontend\web run build
   npm --prefix frontend\web run start
   ```

---

## 4. QR Connection & Manual Real-Device Delivery Instructions

1. Retrieve your local `WHATSAPP_ADMIN_KEY` from `.env` (never share or expose this key in client-side source files or public links).
2. Open `http://localhost:3001/admin/whatsapp` in your browser and enter `WHATSAPP_ADMIN_KEY` to unlock the merchant console.
3. Click **Connect WhatsApp**. Wait 2–4 seconds for status to transition `CONNECTING` -> `QR_READY` and the pairing QR code image to appear.
4. On an authorized WhatsApp mobile account, open **WhatsApp -> Settings -> Linked Devices -> Link a Device** and scan the QR code.
5. Confirm status transitions to `CONNECTED` and the masked connected number appears.
6. In **Send Authorized Test Message**, enter your authorized test recipient phone number (e.g. `+9198XXXXXXXX`) and click **Send Test Message**. Verify the message arrives on the actual test device and inspect the returned `message_id` and `ack_status` (`sent` vs `delivered`).
7. On `http://localhost:3001/checkout`, switch the contact verification toggle to **Verify via WhatsApp OTP (Experimental)**, verify a 6-digit OTP on the authorized number, place the order (`PENDING_PAYMENT`), and complete JUSPAY Payment OTP -> `PAID` -> PDF receipt email.

---

## 5. Test Results (Including Observed Failures During Implementation)

### Failures Encountered & Resolved During Testing
1. **Pytest `422 Unprocessable Entity` on first WhatsApp integration test run:**
   - Cause: Initial test payload for `POST /api/v1/payments/initiate` omitted required schema fields (`order_id`, `amount`, `currency`, `customer_email`, `upi_details`) and used `simulated_outcome` instead of `outcome`.
   - Fix: Updated `backend/tests/test_whatsapp_integration.py` to match the authoritative checkout-payment schema.
2. **Pytest 10/94 failures (`400 Bad Request` / `is_in_stock` False) on second run:**
   - Cause: Cumulative orders across test runs depleted `store_products.stock_quantity` for `STK-001` to `0` in PostgreSQL.
   - Fix: Restocked catalog products (`STK-001`..`STK-012`) to `SAMPLE_PRODUCTS` defaults before running tests.
3. **Live sidecar `POST /api/v1/admin/whatsapp/connect` HTTP timeout (`10s`) and transient `CB:failure`:**
   - Cause 1: `BerryProtocol.connectWithQr({ waitForConnection: false })` awaited WebSocket artifact setup inside the HTTP request handler past FastAPI's 10s `httpx` timeout. Fix: Updated `WhatsAppBerryService.connect()` to launch handshake asynchronously and yield 150ms so `/internal/connect` responds immediately (`CONNECTING`) while `/status` and `/qr` poll cleanly.
   - Cause 2: `WhatsAppBerryService` originally looked for `creds.json` directly under `WHATSAPP_SESSION_PATH` rather than `<WHATSAPP_SESSION_PATH>/<sessionId>/creds.json` where `@berrysdk/socket` persists credentials. Fix: Updated `#resolveCredsFilePath()` to check `<sessionPath>/<sessionId>/creds.json` first.
   - Note on protocol probe: An isolated 6-second Node diagnostic observed one transient WhatsApp Web `CB:failure` (`Connection Failure`) during socket registration; the subsequent live FastAPI <-> sidecar probe succeeded cleanly in reaching `QR_READY` (`has_qr: True`).

### Final Passing Test Runs
- **Node.js Sidecar Unit Tests (`npm --prefix services\whatsapp test`):** **2/2 passed** (`MockBerryClient`; verifies phone normalization, QR event capture, `connection.open` QR clear, metadata persistence without QR/secrets, OTP send without logging OTPs, and disconnect).
- **Backend Pytest (`.\venv\Scripts\pytest.exe -v tests`):** **94/94 passed** (`MockWhatsAppProvider`, real WhatsApp dispatch disabled in `backend/tests/conftest.py`).
- **Next.js Production Build (`npm --prefix frontend\web run build`):** **Exit 0**, all 9 routes compiled (`/`, `/products`, `/products/[id]`, `/cart`, `/checkout`, `/payment`, `/admin/whatsapp`).
- **Playwright Chromium E2E (`npx playwright test --reporter=list`):** **64/64 passed** (61 existing E2E tests + 3 WhatsApp admin/checkout tests in `automation/web/tests/whatsapp-integration.spec.ts` using browser route stubs for WhatsApp dispatch).
- **Live FastAPI <-> Sidecar Probe:** `GET http://127.0.0.1:8002/health` (`200`), unauthenticated `/api/v1/admin/whatsapp/status` (`401`), authenticated `POST /connect` (`CONNECTING`) -> `GET /status` (`QR_READY`, `has_qr: True`) -> `POST /disconnect` (`DISCONNECTED`).

---

## 6. Real WhatsApp OTP Delivery Verification Status

- **Real-Device WhatsApp Delivery Verified?:** **NO (Not Yet Executed).**
  - The BerryProtocol sidecar successfully reached WhatsApp Web's `QR_READY` pairing state (`has_qr: True`), and all API/OTP/checkout integration paths passed using mock provider doubles without dispatching real messages.
  - Because no mobile device has scanned the QR code on `/admin/whatsapp` yet, **no real WhatsApp message or OTP has been transmitted to or confirmed on a live handset**. Follow Section 4 above with an authorized test number to complete live delivery verification.
