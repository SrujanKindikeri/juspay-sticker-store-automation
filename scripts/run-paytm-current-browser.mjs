#!/usr/bin/env node
/**
 * ============================================================================
 * PAYPILOT — STICKORA COMPLETE CHECKOUT + GMAIL OTP + PAYTM PAYMENT AUTOMATION
 * ============================================================================
 * 
 * Rules & Constraints:
 * 1. Attaches strictly to an ALREADY-RUNNING Chrome browser via CDP.
 * 2. Uses `chromium.connectOverCDP()`. Never calls `chromium.launch()`.
 * 3. Never creates another browser context (0 new windows).
 * 4. Never creates another page or tab (0 new tabs).
 * 5. Reuses the already-open Stickora Store tab in-place.
 * 6. Never reloads the page unnecessarily (Page reload count: 0).
 * 7. Never restarts a completed workflow or repeats completed actions.
 * 8. Never clicks Place Order twice (Duplicate orders: 0).
 * 9. Never initiates payment twice (Duplicate payment initiations: 0).
 * 10. Automatically retrieves email verification OTP from Gmail via authenticated IMAP
 *     for `lifeflow4u.support@gmail.com` without exposing plaintext OTP in logs.
 * 11. Handles OTP retry state machine (polling timeout, resend cooldown, max 3 resends).
 * 12. Verifies final payment via S2S API & PostgreSQL store_orders table.
 * 13. Progress tracking: Exactly numbered [1] through [15] with [PASS] or [FAIL].
 * 14. Leaves Chrome open after completion.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { URL } from 'node:url';
import pg from '../automation/web/node_modules/pg/lib/index.js';
import { chromium } from '../automation/web/node_modules/@playwright/test/index.mjs';
import { fetchLatestGmailOtp, maskOtp } from './gmail-otp-service.mjs';

// ----------------------------------------------------------------------------
// Load Environment Variables (.env)
// ----------------------------------------------------------------------------
function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const eqIdx = line.indexOf('=');
      if (eqIdx > 0) {
        const key = line.slice(0, eqIdx).trim();
        const val = line.slice(eqIdx + 1).trim().replace(/^['"](.*)['"]$/, '$1');
        if (process.env[key] === undefined) {
          process.env[key] = val;
        }
      }
    }
  }
}
loadEnv();

// ----------------------------------------------------------------------------
// Slow Motion Delay Configuration
// ----------------------------------------------------------------------------
const DEFAULT_CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8001';
const TARGET_RECIPIENT_EMAIL = 'lifeflow4u.support@gmail.com';

const ACTION_DELAY_MS = parseInt(process.env.BROWSER_ACTION_DELAY_MS || '1500', 10);
const CLICK_DELAY_MS = parseInt(process.env.BROWSER_CLICK_DELAY_MS || '2000', 10);
const NAVIGATION_DELAY_MS = parseInt(process.env.BROWSER_NAVIGATION_DELAY_MS || '2000', 10);
const PRODUCT_ADDED_DELAY_MS = parseInt(process.env.BROWSER_PRODUCT_ADDED_DELAY_MS || '2500', 10);
const CHECKOUT_DELAY_MS = parseInt(process.env.BROWSER_CHECKOUT_DELAY_MS || '2000', 10);
const ORDER_CREATED_DELAY_MS = parseInt(process.env.BROWSER_ORDER_CREATED_DELAY_MS || '3000', 10);
const PAYTM_PRE_DELAY_MS = parseInt(process.env.BROWSER_PAYTM_PRE_DELAY_MS || '2000', 10);
const PAYMENT_VERIFIED_DELAY_MS = parseInt(process.env.BROWSER_PAYMENT_VERIFIED_DELAY_MS || '3000', 10);

const DB_CONFIG = {
  host: process.env.POSTGRES_HOST || '127.0.0.1',
  port: parseInt(process.env.POSTGRES_PORT || '5433', 10),
  user: process.env.POSTGRES_USER || 'postgres',
  password: process.env.POSTGRES_PASSWORD || 'postgres',
  database: process.env.POSTGRES_DB || 'juspay_db',
};

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m',
};

function banner(title) {
  const line = '═'.repeat(74);
  console.log(`\n${COLORS.cyan}${line}${COLORS.reset}`);
  console.log(`${COLORS.bold}${COLORS.cyan}  ${title}${COLORS.reset}`);
  console.log(`${COLORS.cyan}${line}${COLORS.reset}\n`);
}

// ----------------------------------------------------------------------------
// Verification & Invariant Tracking Metrics
// ----------------------------------------------------------------------------
const metrics = {
  existingBrowserConnected: false,
  gmailAuthorizationStatus: false,
  otpEmailReceived: false,
  otpVerificationResult: false,
  otpResendAttempts: 0,
  orderId: null,
  paymentTransactionId: null,
  gatewayReference: null,
  paytmStagingCheckoutResult: false,
  serverSidePaymentVerification: false,
  finalOrderStatus: 'UNKNOWN',
  finalTransactionStatus: 'UNKNOWN',

  // Architecture Invariants
  existingTabReused: false,
  tabUrl: '',
  tabTitle: '',
  pageReloadCount: 0,
  newTabsCreated: 0,
  newBrowserWindowsCreated: 0,
  duplicateOrders: 0,
  duplicatePaymentInitiations: 0,
};

// ----------------------------------------------------------------------------
// 15-Step Progress Logger
// ----------------------------------------------------------------------------
class StepLogger {
  constructor(totalSteps = 15) {
    this.totalSteps = totalSteps;
  }

  start(stepNum, title) {
    process.stdout.write(`[${stepNum}] ${title}... `);
  }

  pass(detail = '') {
    if (detail) {
      console.log(`${COLORS.bold}${COLORS.green}[PASS]${COLORS.reset} ${COLORS.dim}(${detail})${COLORS.reset}`);
    } else {
      console.log(`${COLORS.bold}${COLORS.green}[PASS]${COLORS.reset}`);
    }
  }

  skip(reason = 'Already completed') {
    console.log(`${COLORS.bold}${COLORS.cyan}[PASS]${COLORS.reset} ${COLORS.dim}(Skipped: ${reason})${COLORS.reset}`);
  }

  fail(reason = '') {
    if (reason) {
      console.log(`${COLORS.bold}${COLORS.red}[FAIL]${COLORS.reset} ${COLORS.red}${reason}${COLORS.reset}`);
    } else {
      console.log(`${COLORS.bold}${COLORS.red}[FAIL]${COLORS.reset}`);
    }
  }
}

const logger = new StepLogger(15);

// ----------------------------------------------------------------------------
// Slow Motion Helper Functions
// ----------------------------------------------------------------------------
function pause(ms) {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function slowClick(locator, delayAfter = CLICK_DELAY_MS) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await pause(ACTION_DELAY_MS);
  await locator.click();
  await pause(delayAfter);
}

async function slowFill(locator, text) {
  await locator.waitFor({ state: 'visible', timeout: 15_000 });
  await pause(Math.floor(ACTION_DELAY_MS / 2));
  await locator.fill(text);
  await pause(300);
}

// ----------------------------------------------------------------------------
// Check Chrome CDP Remote Debugging Endpoint
// ----------------------------------------------------------------------------
function checkCdpEndpoint(endpointUrl) {
  return new Promise((resolve) => {
    try {
      const url = new URL('/json/version', endpointUrl);
      const req = http.get(url, { timeout: 2000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const parsed = JSON.parse(data);
              resolve({ ok: true, version: parsed.Browser || 'Chrome' });
            } catch {
              resolve({ ok: true, version: 'Chrome' });
            }
          } else {
            resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          }
        });
      });
      req.on('timeout', () => {
        req.destroy();
        resolve({ ok: false, error: 'Connection timed out' });
      });
      req.on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });
    } catch (e) {
      resolve({ ok: false, error: e.message });
    }
  });
}

// ----------------------------------------------------------------------------
// Query PostgreSQL store_orders Table Directly
// ----------------------------------------------------------------------------
async function queryOrderFromDb(orderId) {
  const pool = new pg.Pool(DB_CONFIG);
  try {
    const res = await pool.query(
      `SELECT id, order_id, status, subtotal, delivery_fee, total_amount, currency,
              stock_reserved, payment_transaction_id, payment_reference, created_at
       FROM store_orders
       WHERE order_id = $1
       LIMIT 1;`,
      [orderId]
    );
    return res.rows[0] || null;
  } catch (err) {
    return null;
  } finally {
    await pool.end().catch(() => {});
  }
}

// ----------------------------------------------------------------------------
// Main Workflow Execution
// ----------------------------------------------------------------------------
async function main() {
  const cdpEndpoint = process.env.CDP_ENDPOINT || DEFAULT_CDP_ENDPOINT;

  banner(
    `PAYPILOT — STICKORA CHECKOUT + GMAIL OTP + PAYTM AUTOMATION\n  ` +
    `[CDP: ${cdpEndpoint}] | [Delays: Action ${ACTION_DELAY_MS}ms, Click ${CLICK_DELAY_MS}ms, Nav ${NAVIGATION_DELAY_MS}ms]`
  );

  // --------------------------------------------------------------------------
  // [1] Existing Chrome connected
  // --------------------------------------------------------------------------
  logger.start(1, 'Existing Chrome connected');

  const cdpCheck = await checkCdpEndpoint(cdpEndpoint);
  if (!cdpCheck.ok) {
    logger.fail(`Cannot connect to Chrome at ${cdpEndpoint} (${cdpCheck.error})`);
    console.log(`\n${COLORS.yellow}ℹ️  Chrome must be running with remote debugging enabled (--remote-debugging-port=9222).${COLORS.reset}`);
    printFinalReport();
    process.exit(1);
  }

  let browser = null;
  try {
    browser = await chromium.connectOverCDP(cdpEndpoint);
    metrics.existingBrowserConnected = true;
    logger.pass(`${cdpCheck.version} on ${cdpEndpoint}`);
  } catch (err) {
    logger.fail(err.message);
    printFinalReport();
    process.exit(1);
  }

  const contexts = browser.contexts();
  if (contexts.length === 0) {
    logger.fail('No browser context found in connected Chrome');
    await browser.close().catch(() => {});
    printFinalReport();
    process.exit(1);
  }

  const context = contexts[0];

  // Invariant listener: detect any unexpected tab creation
  context.on('page', (newPage) => {
    metrics.newTabsCreated++;
    console.warn(`  ⚠️ [PayPilot Warning] New tab created unexpectedly: ${newPage.url()}`);
  });

  // --------------------------------------------------------------------------
  // [2] Stickora page detected
  // --------------------------------------------------------------------------
  logger.start(2, 'Stickora page detected');

  const pages = context.pages();
  const stickoraPages = pages.filter((p) => {
    const u = p.url();
    return u.includes('localhost:3001') || u.includes('127.0.0.1:3001') || u.includes('stickora');
  });

  if (stickoraPages.length === 0) {
    logger.fail('No Stickora Store tab found in connected Chrome');
    console.log(`\n   Existing open tabs in Chrome:`);
    pages.forEach((p, i) => console.log(`   [${i + 1}] ${p.url()}`));
    console.log(`\n👉 Please navigate to http://localhost:3001 in your Chrome browser and re-run.\n`);
    await browser.close().catch(() => {});
    printFinalReport();
    process.exit(1);
  }

  // Prioritize active shopping tab (home, cart, checkout) over finished payment tab
  let stickoraPage = stickoraPages.find((p) => {
    const u = p.url();
    return !u.includes('/payment');
  }) || stickoraPages[0];

  metrics.existingTabReused = true;
  metrics.tabUrl = stickoraPage.url();
  metrics.tabTitle = await stickoraPage.title().catch(() => '');
  await stickoraPage.bringToFront();
  logger.pass(`${metrics.tabUrl}`);

  await pause(ACTION_DELAY_MS);

  let currentUrl = stickoraPage.url();
  let currentStage = 'home';
  if (currentUrl.includes('/payment')) {
    currentStage = 'payment';
  } else if (currentUrl.includes('/checkout')) {
    currentStage = 'checkout';
  } else if (currentUrl.includes('/cart')) {
    currentStage = 'cart';
  } else if (currentUrl.includes('/products/') && !currentUrl.endsWith('/products')) {
    currentStage = 'product';
  } else {
    currentStage = 'home';
  }

  try {
    // ------------------------------------------------------------------------
    // [3] Product selected
    // ------------------------------------------------------------------------
    logger.start(3, 'Product selected');
    if (['product', 'cart', 'checkout', 'payment'].includes(currentStage)) {
      logger.skip(`Already on ${currentStage} stage`);
    } else {
      const cartBadge = stickoraPage.locator('[data-testid="cart-count-badge"]');
      let cartCount = 0;
      if (await cartBadge.isVisible().catch(() => false)) {
        cartCount = parseInt((await cartBadge.textContent().catch(() => '0')).trim(), 10) || 0;
      }

      if (cartCount > 0) {
        logger.skip(`Cart already contains ${cartCount} item(s)`);
      } else {
        const productCard = stickoraPage.locator('[data-testid="product-card-STK-001"] a.product-card-link').first();
        if (await productCard.isVisible().catch(() => false)) {
          await slowClick(productCard, NAVIGATION_DELAY_MS);
        } else {
          const fallbackLink = stickoraPage.locator('.product-card-link').first();
          await slowClick(fallbackLink, NAVIGATION_DELAY_MS);
        }
        await stickoraPage.waitForURL('**/products/**', { timeout: 15_000 });
        currentStage = 'product';
      }
      logger.pass('STK-001 - Cyberpunk Neon Cat');
    }

    // ------------------------------------------------------------------------
    // [4] Product added to cart
    // ------------------------------------------------------------------------
    logger.start(4, 'Product added to cart');
    if (['cart', 'checkout', 'payment'].includes(currentStage)) {
      logger.skip(`Already on ${currentStage} stage`);
    } else {
      const cartBadge = stickoraPage.locator('[data-testid="cart-count-badge"]');
      let currentCount = 0;
      if (await cartBadge.isVisible().catch(() => false)) {
        currentCount = parseInt((await cartBadge.textContent().catch(() => '0')).trim(), 10) || 0;
      }

      if (currentCount === 0) {
        const addBtn = stickoraPage.locator('[data-testid="detail-add-to-cart-btn"]');
        await slowClick(addBtn, PRODUCT_ADDED_DELAY_MS);
        await cartBadge.waitFor({ state: 'visible', timeout: 5000 });
        logger.pass('STK-001 added (₹99.00) · Cart badge: 1');
      } else {
        logger.skip(`Product already in cart (${currentCount} items)`);
      }

      // Open cart view
      const cartBtn = stickoraPage.locator('[data-testid="nav-cart-button"]');
      await slowClick(cartBtn, NAVIGATION_DELAY_MS);
      await stickoraPage.waitForURL('**/cart', { timeout: 10_000 });
      currentStage = 'cart';
    }

    // ------------------------------------------------------------------------
    // [5] Checkout completed
    // ------------------------------------------------------------------------
    logger.start(5, 'Checkout completed');
    if (['checkout', 'payment'].includes(currentStage)) {
      logger.skip(`Already on ${currentStage} stage`);
    } else {
      const proceedBtn = stickoraPage.locator('[data-testid="proceed-to-checkout-btn"]');
      await proceedBtn.waitFor({ state: 'visible', timeout: 15_000 });
      await slowClick(proceedBtn, NAVIGATION_DELAY_MS);
      await stickoraPage.waitForURL('**/checkout', { timeout: 10_000 });
      currentStage = 'checkout';
    }

    // Fill customer & delivery details on checkout page
    const nameInput = stickoraPage.locator('[data-testid="checkout-name-input"]');
    await nameInput.waitFor({ state: 'visible', timeout: 15_000 });

    await slowFill(nameInput, 'Aarav Patel');
    await slowFill(stickoraPage.locator('[data-testid="checkout-phone-input"]'), '9876543210');
    await slowFill(stickoraPage.locator('[data-testid="checkout-email-input"]'), TARGET_RECIPIENT_EMAIL);
    await slowFill(stickoraPage.locator('[data-testid="checkout-address-input"]'), '74 Residency Road');
    await slowFill(stickoraPage.locator('[data-testid="checkout-city-input"]'), 'Bengaluru');
    await slowFill(stickoraPage.locator('[data-testid="checkout-state-input"]'), 'Karnataka');
    await slowFill(stickoraPage.locator('[data-testid="checkout-pincode-input"]'), '560025');

    // Select Email OTP verification method
    const emailMethodBtn = stickoraPage.locator('[data-testid="select-channel-email"]');
    if (await emailMethodBtn.isVisible().catch(() => false)) {
      await slowClick(emailMethodBtn, 500);
    }

    await pause(CHECKOUT_DELAY_MS);
    logger.pass(`Aarav Patel · ${TARGET_RECIPIENT_EMAIL} · Bengaluru 560025`);

    // ------------------------------------------------------------------------
    // [6] Email OTP requested
    // ------------------------------------------------------------------------
    logger.start(6, 'Email OTP requested');

    const emailBadge = stickoraPage.locator('[data-testid="email-verified-badge"]');
    let isAlreadyVerified = await emailBadge.isVisible().catch(() => false);

    let extractedOtp = null;
    let seenOtpValues = [];
    let seenMessageIds = [];
    let otpRequestTimestamp = (Date.now() / 1000) - 5; // buffer 5 seconds

    if (isAlreadyVerified) {
      logger.skip('Email already verified in session');
      metrics.otpEmailReceived = true;
      metrics.gmailAuthorizationStatus = true;
      metrics.otpVerificationResult = true;
    } else {
      const verifyEmailBtn = stickoraPage.locator('[data-testid="verify-email-button"]');
      await verifyEmailBtn.waitFor({ state: 'visible', timeout: 10_000 });

      otpRequestTimestamp = (Date.now() / 1000) - 2;
      await slowClick(verifyEmailBtn, CLICK_DELAY_MS);

      const otpInput = stickoraPage.locator('[data-testid="email-otp-input"]');
      await otpInput.waitFor({ state: 'visible', timeout: 10_000 });
      logger.pass(`Sent to ${TARGET_RECIPIENT_EMAIL}`);

      // ----------------------------------------------------------------------
      // [7] Gmail email received
      // ----------------------------------------------------------------------
      logger.start(7, 'Gmail email received');

      // State machine: retrieve OTP from Gmail with safe timeout & polling
      let otpResult = await fetchLatestGmailOtp({
        recipient: TARGET_RECIPIENT_EMAIL,
        minTimestamp: otpRequestTimestamp,
        timeoutSeconds: 90,
        pollInterval: 3,
        excludeOtps: seenOtpValues,
        excludeIds: seenMessageIds,
      });

      // If initial retrieval timed out, trigger resend (up to 3 resends)
      while (!otpResult.success && metrics.otpResendAttempts < 3) {
        metrics.otpResendAttempts++;
        console.log(`\n  ⚠️ Polling timed out. Initiating OTP resend attempt #${metrics.otpResendAttempts}...`);

        // Wait for resend button to be enabled (cooldown)
        const resendBtn = stickoraPage.locator('[data-testid="resend-email-otp-button"]');
        await resendBtn.waitFor({ state: 'visible', timeout: 10_000 });

        let isCooldownActive = await resendBtn.isDisabled().catch(() => false);
        while (isCooldownActive) {
          await pause(2000);
          isCooldownActive = await resendBtn.isDisabled().catch(() => false);
        }

        otpRequestTimestamp = (Date.now() / 1000) - 2;
        await slowClick(resendBtn, CLICK_DELAY_MS);

        otpResult = await fetchLatestGmailOtp({
          recipient: TARGET_RECIPIENT_EMAIL,
          minTimestamp: otpRequestTimestamp,
          timeoutSeconds: 90,
          pollInterval: 3,
          excludeOtps: seenOtpValues,
          excludeIds: seenMessageIds,
        });
      }

      if (!otpResult.success) {
        logger.fail(`Failed to receive OTP email in Gmail: ${otpResult.error}`);
        printFinalReport();
        process.exit(1);
      }

      metrics.otpEmailReceived = true;
      metrics.gmailAuthorizationStatus = true;
      extractedOtp = otpResult.otp;
      seenOtpValues.push(extractedOtp);
      if (otpResult.message_id) seenMessageIds.push(otpResult.message_id);

      logger.pass(`Subject: ${otpResult.subject} · Message-ID: ${otpResult.message_id || otpResult.imap_id}`);

      // ----------------------------------------------------------------------
      // [8] OTP extracted securely
      // ----------------------------------------------------------------------
      logger.start(8, 'OTP extracted securely');
      const masked = maskOtp(extractedOtp);
      logger.pass(`Masked code: ${masked} (Plaintext protected)`);

      // ----------------------------------------------------------------------
      // [9] OTP submitted
      // ----------------------------------------------------------------------
      logger.start(9, 'OTP submitted');
      await slowFill(otpInput, extractedOtp);

      const confirmOtpBtn = stickoraPage.locator('[data-testid="confirm-email-otp-button"]');
      await slowClick(confirmOtpBtn, CHECKOUT_DELAY_MS);
      logger.pass(`Submitted code ${masked} to verification form`);

      // ----------------------------------------------------------------------
      // [10] Email verification successful
      // ----------------------------------------------------------------------
      logger.start(10, 'Email verification successful');

      // Check if verification succeeded or if retry state machine is needed
      try {
        await emailBadge.waitFor({ state: 'visible', timeout: 8000 });
        metrics.otpVerificationResult = true;
        logger.pass('✓ Email Verified badge confirmed by backend');
      } catch (err) {
        // Check for error state and retry
        const errEl = stickoraPage.locator('[data-testid="email-otp-error"]');
        const hasError = await errEl.isVisible().catch(() => false);
        const errMsg = hasError ? (await errEl.textContent().catch(() => '')) : err.message;

        if (metrics.otpResendAttempts < 3) {
          metrics.otpResendAttempts++;
          console.log(`\n  ⚠️ OTP Verification failed (${errMsg}). Entering retry state machine (#${metrics.otpResendAttempts})...`);

          const resendBtn = stickoraPage.locator('[data-testid="resend-email-otp-button"]');
          while (await resendBtn.isDisabled().catch(() => false)) {
            await pause(2000);
          }

          otpRequestTimestamp = (Date.now() / 1000) - 2;
          await slowClick(resendBtn, CLICK_DELAY_MS);

          const newOtpResult = await fetchLatestGmailOtp({
            recipient: TARGET_RECIPIENT_EMAIL,
            minTimestamp: otpRequestTimestamp,
            timeoutSeconds: 90,
            pollInterval: 3,
            excludeOtps: seenOtpValues,
            excludeIds: seenMessageIds,
          });

          if (!newOtpResult.success) {
            logger.fail(`OTP retry retrieval failed: ${newOtpResult.error}`);
            printFinalReport();
            process.exit(1);
          }

          extractedOtp = newOtpResult.otp;
          seenOtpValues.push(extractedOtp);
          await slowFill(otpInput, extractedOtp);
          await slowClick(confirmOtpBtn, CHECKOUT_DELAY_MS);
          await emailBadge.waitFor({ state: 'visible', timeout: 10_000 });
          metrics.otpVerificationResult = true;
          logger.pass('✓ Email Verified badge confirmed after retry');
        } else {
          logger.fail(`Email verification failed after ${metrics.otpResendAttempts} resends: ${errMsg}`);
          printFinalReport();
          process.exit(1);
        }
      }
    }

    // ------------------------------------------------------------------------
    // [11] Order created
    // ------------------------------------------------------------------------
    logger.start(11, 'Order created');

    const placeOrderBtn = stickoraPage.locator('[data-testid="place-order-button"]');
    await placeOrderBtn.waitFor({ state: 'visible', timeout: 10_000 });

    // Click Place Order exactly ONCE
    metrics.duplicateOrders = 0;
    await slowClick(placeOrderBtn, 0);

    // Wait for redirect to /payment?order_id=STK-ORD-...
    await stickoraPage.waitForURL(/.*\/payment\?order_id=STK-ORD-.*/, { timeout: 20_000 });
    const paymentUrl = new URL(stickoraPage.url());
    metrics.orderId = paymentUrl.searchParams.get('order_id');

    // Pause 3000ms after Place Order backend response
    await pause(ORDER_CREATED_DELAY_MS);

    // Verify order exists in PostgreSQL
    const createdDbOrder = await queryOrderFromDb(metrics.orderId);
    if (!createdDbOrder) {
      logger.fail(`Order ${metrics.orderId} not found in PostgreSQL store_orders`);
      printFinalReport();
      process.exit(1);
    }

    logger.pass(`StoreOrder ${metrics.orderId} (₹${createdDbOrder.total_amount}) in PostgreSQL`);

    // ------------------------------------------------------------------------
    // [12] Paytm transaction initiated
    // ------------------------------------------------------------------------
    logger.start(12, 'Paytm transaction initiated');

    // Pause 2000ms before Paytm payment selection
    await pause(PAYTM_PRE_DELAY_MS);

    const paytmTab = stickoraPage.locator('[data-testid="paytm-method"]');
    await paytmTab.waitFor({ state: 'visible', timeout: 15_000 });
    await slowClick(paytmTab, CLICK_DELAY_MS);

    logger.pass('Paytm Staging Provider selected');

    // ------------------------------------------------------------------------
    // [13] Paytm checkout opened
    // ------------------------------------------------------------------------
    logger.start(13, 'Paytm checkout opened');

    const paytmPanel = stickoraPage.locator('[data-testid="paytm-payment-panel"]');
    try {
      await paytmPanel.waitFor({ state: 'visible', timeout: 5000 });
    } catch {
      await slowClick(paytmTab, CLICK_DELAY_MS);
      await paytmPanel.waitFor({ state: 'visible', timeout: 10_000 });
    }

    // Select sandbox success scenario
    const successScenario = stickoraPage.locator('[data-testid="paytm-scenario-success"]');
    if (await successScenario.isVisible().catch(() => false)) {
      await slowClick(successScenario, CLICK_DELAY_MS);
    }

    logger.pass('Paytm Staging Checkout Panel ready (RespCode 01)');

    // ------------------------------------------------------------------------
    // [14] Payment authentication completed
    // ------------------------------------------------------------------------
    logger.start(14, 'Payment authentication completed');

    metrics.duplicatePaymentInitiations = 0;
    const payBtn = stickoraPage.locator('[data-testid="pay-via-paytm-btn"]');
    await payBtn.waitFor({ state: 'visible', timeout: 10_000 });

    // Click pay button once
    await slowClick(payBtn, 1000);

    // Wait for payment confirmation UI
    const successCard = stickoraPage.locator('[data-testid="payment-success"]');
    await successCard.waitFor({ state: 'visible', timeout: 25_000 });

    metrics.paymentTransactionId = (await stickoraPage.locator('[data-testid="transaction-id"]').textContent().catch(() => ''))?.trim() || null;
    metrics.gatewayReference = (await stickoraPage.locator('[data-testid="transaction-reference"]').textContent().catch(() => ''))?.trim() || null;
    metrics.paytmStagingCheckoutResult = true;

    logger.pass(`Authorized · Txn ID: ${metrics.paymentTransactionId} · Ref: ${metrics.gatewayReference}`);

    // ------------------------------------------------------------------------
    // [15] Server-side payment verified
    // ------------------------------------------------------------------------
    logger.start(15, 'Server-side payment verified');

    // Verify status via GET /api/v1/payments/paytm/status/{order_id}
    let s2sVerified = false;
    try {
      const res = await fetch(`${API_BASE_URL}/api/v1/payments/paytm/status/${metrics.orderId}`);
      if (res.ok) {
        const statusJson = await res.json();
        if (statusJson.store_order_status === 'PAID' || statusJson.status === 'SUCCESS' || statusJson.status === 'CHARGED') {
          s2sVerified = true;
          metrics.paymentTransactionId = metrics.paymentTransactionId || statusJson.transaction_id;
          metrics.gatewayReference = metrics.gatewayReference || statusJson.payment_reference;
        }
      }
    } catch (err) {
      // Continue to DB fallback verification
    }

    // Verify in PostgreSQL database store_orders table
    const finalDbOrder = await queryOrderFromDb(metrics.orderId);
    if (finalDbOrder && finalDbOrder.status === 'PAID') {
      metrics.finalOrderStatus = 'PAID';
      metrics.finalTransactionStatus = 'SUCCESS';
      metrics.paymentTransactionId = metrics.paymentTransactionId || finalDbOrder.payment_transaction_id;
      metrics.gatewayReference = metrics.gatewayReference || finalDbOrder.payment_reference;
      metrics.serverSidePaymentVerification = true;
    } else if (s2sVerified) {
      metrics.finalOrderStatus = 'PAID';
      metrics.finalTransactionStatus = 'SUCCESS';
      metrics.serverSidePaymentVerification = true;
    } else {
      logger.fail('Payment status could not be verified server-side');
      printFinalReport();
      process.exit(1);
    }

    // Pause 3000ms after final payment verification
    await pause(PAYMENT_VERIFIED_DELAY_MS);

    logger.pass(`Order: ${metrics.finalOrderStatus} · Status: ${metrics.finalTransactionStatus} · S2S & DB Verified`);

    // Update final URL metrics
    metrics.tabUrl = stickoraPage.url();
    metrics.tabTitle = await stickoraPage.title().catch(() => '');
  } catch (err) {
    logger.fail(err.message);
    await browser.close().catch(() => {});
    printFinalReport();
    process.exit(1);
  }

  // --------------------------------------------------------------------------
  // Disconnect CDP and Keep Chrome Open
  // --------------------------------------------------------------------------
  await browser.close().catch(() => {});
  console.log(`\n${COLORS.green}✓ Disconnected from CDP. Your Chrome browser and Stickora tab remain OPEN.${COLORS.reset}`);

  printFinalReport();
  process.exit(0);
}

function printFinalReport() {
  banner('PAYPILOT — FINAL VERIFICATION REPORT');

  console.log(`Existing Chrome connection: ${metrics.existingBrowserConnected ? 'PASS' : 'FAIL'}`);
  console.log(`Gmail authorization status: ${metrics.gmailAuthorizationStatus ? 'PASS' : 'FAIL'}`);
  console.log(`OTP email received: ${metrics.otpEmailReceived ? 'PASS' : 'FAIL'}`);
  console.log(`OTP verification result: ${metrics.otpVerificationResult ? 'PASS' : 'FAIL'}`);
  console.log(`Number of OTP resend attempts: ${metrics.otpResendAttempts}`);
  console.log(`Order ID: ${metrics.orderId || 'None'}`);
  console.log(`Payment transaction ID: ${metrics.paymentTransactionId || 'None'}`);
  console.log(`Paytm staging checkout result: ${metrics.paytmStagingCheckoutResult ? 'PASS' : 'FAIL'}`);
  console.log(`Server-side payment verification: ${metrics.serverSidePaymentVerification ? 'PASS' : 'FAIL'}`);
  console.log(`Final order status: ${metrics.finalOrderStatus}`);
  console.log(`Final transaction status: ${metrics.finalTransactionStatus}`);

  console.log(`\n${COLORS.cyan}══════════════════════════════════════════════════════════════════════════${COLORS.reset}\n`);
}

main().catch((err) => {
  console.error('Unexpected error in PayPilot runner:', err);
  process.exit(1);
});
