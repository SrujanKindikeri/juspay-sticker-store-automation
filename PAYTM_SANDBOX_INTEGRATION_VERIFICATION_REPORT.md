# Paytm Sandbox Integration & Automated Payment Testing Report

**Project:** Stickora Store & Juspay Payment Automation  
**Date:** November 27, 2026  
**Environment:** Windows (PowerShell), Python 3.11, Next.js 14, PostgreSQL 16  
**Primary Commands:**
- Headed Visible Runner: `npm run test:paytm-e2e:headed`
- Headless CI Runner: `npm run test:paytm-e2e`

---

## 1. Executive Summary

The Stickora Store and Juspay Payment Automation project has been updated to support **Headed Visible Execution** alongside headless automation. You can now **WATCH** the entire customer journey in a real Chromium browser window with **800ms slow motion**, real-time terminal stage logging, full video recording, trace collection, and stage screenshots.

### Key Milestones Delivered:
1. **Headed Visible Browser Execution (`npm run test:paytm-e2e:headed`):** Opens a real visible browser window with 800ms pacing between actions, allowing observers to see product selection, checkout form filling, Paytm payment selection, initiation, and receipt rendering live on screen.
2. **Terminal Stage Logging:** Emits structured real-time logs in the terminal distinguishing automated mocked runs (`🔵 [AUTOMATED MOCKED SANDBOX]`) from genuine live calls (`🔴 [GENUINE PAYTM STAGING]`).
3. **Genuine Staging Pre-Flight Validator:** Verifies `PAYMENT_PROVIDER`, `PAYTM_MID`, `PAYTM_MERCHANT_KEY`, and staging endpoint reachability. If credentials are missing, stops the genuine test with a detailed diagnostic without silently falling back to a mock.
4. **Complete Test Evidence Collection:** Saves stage screenshots to `automation/web/screenshots/paytm/`, full WebM video recordings to `automation/web/test-results/`, and failure trace archives.
5. **Database State Verification:** Confirms PostgreSQL order transitions (`PENDING_PAYMENT -> PAID` on success, `PENDING_PAYMENT -> PAYMENT_FAILED` on decline) and stock restoration.

---

## 2. Visible Execution Flow & Terminal Logging

```text
══════════════════════════════════════════════════════════════════════════
  STICKORA STORE — PAYTM SANDBOX E2E TEST RUNNER
  [MODE: HEADED (VISIBLE BROWSER · 800ms SLOW MOTION)]
══════════════════════════════════════════════════════════════════════════

▶ Step 1: Inspecting Configuration & Security Environment
──────────────────────────────────────────────────────────────────────
  ✓ Found root configuration file (.env)
    • Active Provider       : simulated
    • Paytm Merchant MID    : Not configured (mock fallback)
    • Browser Mode          : HEADED (Visible window, 800ms slowMo)
    • Automated Mocked Tests: ENABLED (Deterministic Cryptographic Simulation)
    • Genuine Staging Tests : STOPPED / SKIPPED (Missing staging credentials in .env)
      └─ Missing: PAYMENT_PROVIDER is 'simulated' (Requires: 'paytm')
      └─ Missing: PAYTM_MID is missing or empty in .env
      └─ Missing: PAYTM_MERCHANT_KEY is missing or empty in .env

▶ Step 2: Checking Service Infrastructure Connectivity
──────────────────────────────────────────────────────────────────────
  • PostgreSQL Database (port 5433)     : ONLINE (Connected)
  • FastAPI Backend Server (port 8001)   : ONLINE (Healthy)
  • Next.js Storefront (port 3001)       : ONLINE (Ready)
  • Paytm Staging Gateway (HTTPS reach) : LIMITED (Offline / Firewall)

▶ Step 3: Executing Pytest Backend Paytm Integration Suite
──────────────────────────────────────────────────────────────────────
  Target: backend/tests/test_paytm_provider.py
======================== 9 passed, 1 warning in 3.32s =========================
  Pytest Backend Execution: PASSED (11.38s)

▶ Step 4: Executing Playwright E2E Test Suite (HEADED VISIBLE BROWSER)
──────────────────────────────────────────────────────────────────────
  Target: automation/web/tests/paytm-payment.spec.ts
  🖥️  HEADED MODE ACTIVE: A real Chromium browser window will open.
  Actions are paced with 800ms slow motion so you can watch each stage live.

Running 4 tests using 1 worker

🔵 [AUTOMATED MOCKED SANDBOX] [12:00:57 pm] Stage 1: Store opened
   └─ Details: Navigated to Stickora Store catalogue at /products

🔵 [AUTOMATED MOCKED SANDBOX] [12:00:59 pm] Stage 2: Product added
   └─ Details: Selected STK-001 (Cyberpunk Neon Cat) and added 1 unit (₹99.00) to shopping cart

🔵 [AUTOMATED MOCKED SANDBOX] [12:01:11 pm] Stage 3: Checkout opened
   └─ Details: Delivery details filled: Aarav Patel, 74 Residency Road, Bengaluru, PIN: 560025, Contact verified

🔵 [AUTOMATED MOCKED SANDBOX] [12:01:12 pm] Stage 4: Order created
   └─ Details: StoreOrder STK-ORD-F1717B7C20 registered in PostgreSQL with status PENDING_PAYMENT, Total Payable: ₹149.00

🔵 [AUTOMATED MOCKED SANDBOX] [12:01:14 pm] Stage 5: Paytm selected
   └─ Details: Selected Paytm Payment Gateway (Sandbox Staging) method in payment selector

🔵 [AUTOMATED MOCKED SANDBOX] [12:01:15 pm] Stage 6: Paytm initiation request sent
   └─ Details: Calling /api/v1/payments/paytm/initiate for STK-ORD-F1717B7C20 (Amount: ₹149.00)

🔵 [AUTOMATED MOCKED SANDBOX] [12:01:15 pm] Stage 7: Paytm checkout opened
   └─ Details: Paytm Checkout JS session initialized with authoritative txnToken

🔵 [AUTOMATED MOCKED SANDBOX] [12:01:16 pm] Stage 8: Customer authentication completed & verified
   └─ Details: Transaction finalized: Txn ID: TXN_PTM_C40C2234FF46, Gateway Ref: REF_PTM_7DC4EE53D633

🔵 [AUTOMATED MOCKED SANDBOX] [12:01:16 pm] Stage 9: Order status confirmed
   └─ Details: PostgreSQL verification passed: StoreOrder STK-ORD-F1717B7C20 status is PAID, stock permanent reserve confirmed
  ok 1 [chromium] › 1. Full E2E Journey: Store shopping -> Checkout -> Paytm Sandbox Success -> Order PAID (23.1s)
```

---

## 3. Genuine Paytm Sandbox Pre-Flight Diagnostic

When running without live staging credentials in `.env`, the genuine test (`Test 4`) cleanly stops and prints:

```text
========================================================================
🔴 [GENUINE PAYTM STAGING] Pre-flight Verification Check
========================================================================

⚠️  GENUINE PAYTM SANDBOX TEST STOPPED: Missing Required Credentials
   The genuine sandbox test cannot proceed because the following requirements are missing:
   ❌ PAYMENT_PROVIDER is set to 'simulated' (Must be explicitly 'paytm')
   ❌ PAYTM_MID is missing or using placeholder in .env
   ❌ PAYTM_MERCHANT_KEY is missing or using placeholder in .env

   📋 To enable Genuine Live Staging tests against https://securegw-stage.paytm.in:
   1. Sign up on https://dashboard.paytm.com/ (Staging Mode)
   2. Set PAYMENT_PROVIDER=paytm in .env
   3. Set PAYTM_MID=<your-staging-mid> in .env
   4. Set PAYTM_MERCHANT_KEY=<your-staging-key> in .env
   5. Restart backend: .\backend\venv\Scripts\python.exe -m uvicorn app.main:app --port 8001
   6. Re-run: npm run test:paytm-e2e:headed

   NOTE: Mocked sandbox fallback was NOT used because genuine mode strictly prohibits silent fallback.
========================================================================
```

---

## 4. Test Evidence Artifacts

| Evidence Type | Location | Details |
| :--- | :--- | :--- |
| **Stage Screenshots** | `automation/web/screenshots/paytm/` | 10 distinct stage screenshots captured during execution |
| **Video Recordings** | `automation/web/test-results/**/*.webm` | Full-motion WebM browser recordings of all journeys |
| **Trace Archives** | `automation/web/test-results/**/*.zip` | Playwright step-by-step DOM and network trace files |
| **HTML Report** | `automation/web/playwright-report/index.html` | Interactive Playwright test report |

### Captured Stage Screenshots:
1. `01-store-opened.png` — Product catalogue loaded at `/products`.
2. `02-product-added.png` — STK-001 added to shopping cart with badge update.
3. `03-checkout-opened.png` — Delivery form filled and contact verified.
4. `04-order-created.png` — Order confirmation screen showing `STK-ORD-...`.
5. `05-paytm-selected.png` — Payment page with Paytm Sandbox panel and Staging badge.
6. `08-customer-auth-completed.png` — Verified receipt screen with Transaction ID and Ref.
7. `09-order-status-confirmed.png` — Order settled and database status confirmed as `PAID`.
8. `10-paytm-decline-selected.png` — Bank decline failure simulation scenario selected.
9. `11-payment-result-failed.png` — Failure result screen with declined status.
10. `12-reconciliation-redirect.png` — Callback redirect reconciliation completed.

---

## 5. Security Summary

1. **No Sensitive Data Logged:** Merchant keys, CVVs, full card numbers, and raw auth secrets are never exposed in terminal output or screenshots.
2. **Normalized Checksum Keys:** Checks and normalizes AES keys to strict 16/24/32-byte blocks.
3. **No False Delivery Claims:** A genuine transaction is never reported as passed unless the staging server returns HTTP 200 with `resultStatus: "S"`.
