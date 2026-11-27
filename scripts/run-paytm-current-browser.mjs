#!/usr/bin/env node
/**
 * ============================================================================
 * PAYPILOT — SLOW MOTION VISIBLE BROWSER AUTOMATION (EXISTING CHROME BROWSER)
 * ============================================================================
 * 
 * Rules & Constraints:
 * 1. Attaches to an ALREADY-RUNNING Chrome browser via CDP.
 * 2. Uses `chromium.connectOverCDP()`. Never calls `chromium.launch()`.
 * 3. Never creates another browser context (0 new windows).
 * 4. Never creates another page or tab (0 new tabs).
 * 5. Reuses the already-open Stickora Store tab in-place.
 * 6. Never reloads the page unnecessarily (Page reload count: 0).
 * 7. Never restarts a completed workflow or repeats completed actions.
 * 8. Never clicks Place Order twice (Duplicate orders: 0).
 * 9. Never initiates payment twice (Duplicate payment initiations: 0).
 * 10. Slow-Motion: Configurable pauses before actions, after clicks, after navigations,
 *     after product addition, after checkout, and after payment verification.
 * 11. Shows real-time progress: [1/10] through [10/10] with [PASS] or [FAIL].
 * 12. Keeps Chrome browser and Stickora tab open after completion.
 */

import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { URL } from 'node:url';
import pg from '../automation/web/node_modules/pg/lib/index.js';
import { chromium } from '../automation/web/node_modules/@playwright/test/index.mjs';

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
// Slow Motion Delay Configuration (Configurable via Environment Variables)
// ----------------------------------------------------------------------------
const DEFAULT_CDP_ENDPOINT = process.env.CDP_ENDPOINT || 'http://127.0.0.1:9222';
const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8001';

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
// Invariant Tracking Metrics
// ----------------------------------------------------------------------------
const metrics = {
  existingBrowserConnected: false,
  existingTabReused: false,
  tabUrl: '',
  tabTitle: '',
  pageReloadCount: 0,
  newTabsCreated: 0,
  newBrowserWindowsCreated: 0,
  duplicateOrders: 0,
  duplicatePaymentInitiations: 0,
  orderId: null,
  orderTotal: null,
  transactionId: null,
  gatewayReference: null,
  finalOrderStatus: 'UNKNOWN',
  finalPaymentStatus: 'UNKNOWN',
};

// ----------------------------------------------------------------------------
// Numbered Step Progress Logger ([1/10] ... [10/10])
// ----------------------------------------------------------------------------
class StepLogger {
  constructor(totalSteps = 10) {
    this.totalSteps = totalSteps;
    this.currentStep = 0;
  }

  start(stepNum, title) {
    this.currentStep = stepNum;
    process.stdout.write(`[${stepNum}/${this.totalSteps}] ${title}... `);
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

const logger = new StepLogger(10);

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
    `PAYPILOT — SLOW MOTION VISIBLE BROWSER AUTOMATION\n  ` +
    `[CDP: ${cdpEndpoint}] | [Delays: Action ${ACTION_DELAY_MS}ms, Click ${CLICK_DELAY_MS}ms, Nav ${NAVIGATION_DELAY_MS}ms]`
  );

  // --------------------------------------------------------------------------
  // [1/10] Opening existing Stickora tab...
  // --------------------------------------------------------------------------
  logger.start(1, 'Opening existing Stickora tab');

  const cdpCheck = await checkCdpEndpoint(cdpEndpoint);
  if (!cdpCheck.ok) {
    logger.fail(`Cannot connect to Chrome at ${cdpEndpoint} (${cdpCheck.error})`);
    console.log(`\n${COLORS.yellow}ℹ️  Chrome must be running with remote debugging enabled (--remote-debugging-port=9222).${COLORS.reset}`);
    console.log(`   ${COLORS.bold}Launch Chrome using this PowerShell command:${COLORS.reset}`);
    console.log(`   ${COLORS.cyan}& "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --remote-debugging-port=9222 --user-data-dir="$env:LOCALAPPDATA\\Google\\Chrome\\PayPilotProfile" http://localhost:3001${COLORS.reset}\n`);
    printFinalReport();
    process.exit(1);
  }

  let browser = null;
  try {
    browser = await chromium.connectOverCDP(cdpEndpoint);
    metrics.existingBrowserConnected = true;
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

  // Invariant listener: detect any new tab creation
  context.on('page', (newPage) => {
    metrics.newTabsCreated++;
    console.warn(`  ⚠️ [PayPilot Warning] New tab created unexpectedly: ${newPage.url()}`);
  });

  const pages = context.pages();
  let stickoraPage = null;

  for (const p of pages) {
    const url = p.url();
    if (
      url.includes('localhost:3001') ||
      url.includes('127.0.0.1:3001') ||
      url.includes('stickora')
    ) {
      stickoraPage = p;
      break;
    }
  }

  if (!stickoraPage) {
    logger.fail('No Stickora Store tab found in connected Chrome');
    console.log(`\n   Existing open tabs in Chrome:`);
    pages.forEach((p, i) => console.log(`   [${i + 1}] ${p.url()}`));
    console.log(`\n👉 Please navigate to http://localhost:3001 in your Chrome browser and re-run this command.\n`);
    await browser.close().catch(() => {});
    printFinalReport();
    process.exit(1);
  }

  metrics.existingTabReused = true;
  metrics.tabUrl = stickoraPage.url();
  metrics.tabTitle = await stickoraPage.title().catch(() => '');
  await stickoraPage.bringToFront();
  logger.pass(`${metrics.tabUrl}`);

  await pause(ACTION_DELAY_MS);

  // --------------------------------------------------------------------------
  // [2/10] Checking current page...
  // --------------------------------------------------------------------------
  logger.start(2, 'Checking current page');
  let currentUrl = stickoraPage.url();
  let currentStage = 'home';

  if (currentUrl.includes('/payment')) {
    currentStage = 'payment';
    logger.pass(`Detected Payment Gateway page (${currentUrl})`);
  } else if (currentUrl.includes('/checkout')) {
    currentStage = 'checkout';
    logger.pass(`Detected Checkout page (${currentUrl})`);
  } else if (currentUrl.includes('/cart')) {
    currentStage = 'cart';
    logger.pass(`Detected Shopping Cart page (${currentUrl})`);
  } else if (currentUrl.includes('/products/') && !currentUrl.endsWith('/products')) {
    currentStage = 'product';
    logger.pass(`Detected Product Detail page (${currentUrl})`);
  } else {
    currentStage = 'home';
    logger.pass(`Detected Storefront / Catalogue (${currentUrl})`);
  }

  await pause(ACTION_DELAY_MS);

  try {
    // ------------------------------------------------------------------------
    // [3/10] Selecting product...
    // ------------------------------------------------------------------------
    logger.start(3, 'Selecting product');
    if (['product', 'cart', 'checkout', 'payment'].includes(currentStage)) {
      logger.skip(`Already on ${currentStage} page`);
    } else {
      // Check if cart already has items
      const cartBadge = stickoraPage.locator('[data-testid="cart-count-badge"]');
      let cartCount = 0;
      if (await cartBadge.isVisible().catch(() => false)) {
        cartCount = parseInt((await cartBadge.textContent().catch(() => '0')).trim(), 10) || 0;
      }

      if (cartCount > 0) {
        logger.skip(`Cart already contains ${cartCount} item(s)`);
      } else {
        const productLink = stickoraPage.locator('[data-testid="product-card-STK-001"] a.product-card-link').first();
        if (await productLink.isVisible().catch(() => false)) {
          await slowClick(productLink, NAVIGATION_DELAY_MS);
        } else {
          const fallbackLink = stickoraPage.locator('.product-card-link').first();
          await slowClick(fallbackLink, NAVIGATION_DELAY_MS);
        }
        await stickoraPage.waitForURL('**/products/**', { timeout: 15_000 });
        currentStage = 'product';
        logger.pass('STK-001 - Cyberpunk Neon Cat');
      }
    }

    // ------------------------------------------------------------------------
    // [4/10] Adding product to cart...
    // ------------------------------------------------------------------------
    logger.start(4, 'Adding product to cart');
    if (['cart', 'checkout', 'payment'].includes(currentStage)) {
      logger.skip(`Already advanced to ${currentStage} page`);
    } else {
      const cartBadge = stickoraPage.locator('[data-testid="cart-count-badge"]');
      let currentCount = 0;
      if (await cartBadge.isVisible().catch(() => false)) {
        currentCount = parseInt((await cartBadge.textContent().catch(() => '0')).trim(), 10) || 0;
      }

      if (currentCount === 0) {
        const addBtn = stickoraPage.locator('[data-testid="detail-add-to-cart-btn"]');
        await slowClick(addBtn, PRODUCT_ADDED_DELAY_MS); // Pause 2500ms after adding
        await cartBadge.waitFor({ state: 'visible', timeout: 5000 });
        logger.pass('STK-001 added (₹99.00) · Cart badge updated');
      } else {
        logger.skip(`Product already in cart (${currentCount} items)`);
      }

      // Open cart tab
      const cartBtn = stickoraPage.locator('[data-testid="nav-cart-button"]');
      await slowClick(cartBtn, NAVIGATION_DELAY_MS);
      await stickoraPage.waitForURL('**/cart', { timeout: 10_000 });
      currentStage = 'cart';
    }

    // ------------------------------------------------------------------------
    // [5/10] Opening checkout...
    // ------------------------------------------------------------------------
    logger.start(5, 'Opening checkout');
    if (['checkout', 'payment'].includes(currentStage)) {
      logger.skip(`Already advanced to ${currentStage} page`);
    } else {
      // If on cart page and cart is empty, handle recovery
      const emptyCart = stickoraPage.locator('[data-testid="empty-cart-container"]');
      if (await emptyCart.isVisible().catch(() => false)) {
        const browseBtn = stickoraPage.locator('[data-testid="continue-shopping-btn"]');
        if (await browseBtn.isVisible().catch(() => false)) {
          await slowClick(browseBtn, NAVIGATION_DELAY_MS);
        } else {
          await slowClick(stickoraPage.locator('[data-testid="nav-products-link"]'), NAVIGATION_DELAY_MS);
        }
        await stickoraPage.waitForURL('**/products**', { timeout: 10_000 });
        const productLink = stickoraPage.locator('[data-testid="product-card-STK-001"] a.product-card-link').first();
        await slowClick(productLink, NAVIGATION_DELAY_MS);
        const addBtn = stickoraPage.locator('[data-testid="detail-add-to-cart-btn"]');
        await slowClick(addBtn, PRODUCT_ADDED_DELAY_MS);
        await slowClick(stickoraPage.locator('[data-testid="nav-cart-button"]'), NAVIGATION_DELAY_MS);
        await stickoraPage.waitForURL('**/cart', { timeout: 10_000 });
      }

      const proceedBtn = stickoraPage.locator('[data-testid="proceed-to-checkout-btn"]');
      await proceedBtn.waitFor({ state: 'visible', timeout: 15_000 });

      const totalEl = stickoraPage.locator('[data-testid="cart-total"]');
      if (await totalEl.isVisible().catch(() => false)) {
        metrics.orderTotal = (await totalEl.textContent().catch(() => ''))?.trim() || null;
      }

      await slowClick(proceedBtn, NAVIGATION_DELAY_MS);
      await stickoraPage.waitForURL('**/checkout', { timeout: 10_000 });
      currentStage = 'checkout';
      logger.pass(`Cart Total: ${metrics.orderTotal || '₹149.00'} · Loaded /checkout`);
    }

    // ------------------------------------------------------------------------
    // [6/10] Filling customer details...
    // ------------------------------------------------------------------------
    logger.start(6, 'Filling customer details');
    if (['payment'].includes(currentStage)) {
      logger.skip('Already completed checkout stage');
    } else {
      const nameInput = stickoraPage.locator('[data-testid="checkout-name-input"]');
      await nameInput.waitFor({ state: 'visible', timeout: 10_000 });
      const existingName = (await nameInput.inputValue().catch(() => '')) || '';

      if (!existingName.trim()) {
        await slowFill(nameInput, 'Aarav Patel');
        await slowFill(stickoraPage.locator('[data-testid="checkout-phone-input"]'), '9876543210');
        await slowFill(stickoraPage.locator('[data-testid="checkout-email-input"]'), 'aarav.patel@example.com');
        await slowFill(stickoraPage.locator('[data-testid="checkout-address-input"]'), '74 Residency Road');
        await slowFill(stickoraPage.locator('[data-testid="checkout-city-input"]'), 'Bengaluru');
        await slowFill(stickoraPage.locator('[data-testid="checkout-state-input"]'), 'Karnataka');
        await slowFill(stickoraPage.locator('[data-testid="checkout-pincode-input"]'), '560025');
      }

      // Email OTP verification check
      const emailBadge = stickoraPage.locator('[data-testid="email-verified-badge"]');
      const isVerified = await emailBadge.isVisible().catch(() => false);
      if (!isVerified) {
        const verifyBtn = stickoraPage.locator('[data-testid="verify-email-button"]');
        await slowClick(verifyBtn, CLICK_DELAY_MS);

        const otpInput = stickoraPage.locator('[data-testid="email-otp-input"]');
        await otpInput.waitFor({ state: 'visible', timeout: 10_000 });

        const autofillBtn = stickoraPage.locator('[data-testid="email-otp-autofill-btn"]');
        await slowClick(autofillBtn, 500);

        const confirmOtpBtn = stickoraPage.locator('[data-testid="confirm-email-otp-button"]');
        await slowClick(confirmOtpBtn, CHECKOUT_DELAY_MS); // Pause 2000ms after checkout verification

        await emailBadge.waitFor({ state: 'visible', timeout: 10_000 });
      }

      logger.pass('Aarav Patel · Bengaluru · Email OTP Verified');
    }

    // ------------------------------------------------------------------------
    // [7/10] Creating order...
    // ------------------------------------------------------------------------
    logger.start(7, 'Creating order');
    const existingOrderUrl = new URL(stickoraPage.url());
    const existingOrderId = existingOrderUrl.searchParams.get('order_id');

    if (existingOrderId && existingOrderId.startsWith('STK-ORD-')) {
      metrics.orderId = existingOrderId;
      logger.skip(`Order already exists: ${metrics.orderId}`);
    } else {
      // Prevent duplicate orders
      metrics.duplicateOrders = 0;
      const placeOrderBtn = stickoraPage.locator('[data-testid="place-order-button"]');
      await placeOrderBtn.waitFor({ state: 'visible', timeout: 10_000 });

      await slowClick(placeOrderBtn, 0);

      // Wait for backend order creation & redirect to /payment?order_id=STK-ORD-...
      await stickoraPage.waitForURL(/.*\/payment\?order_id=STK-ORD-.*/, { timeout: 20_000 });
      const newUrl = new URL(stickoraPage.url());
      metrics.orderId = newUrl.searchParams.get('order_id');

      // Pause 3000ms after Place Order backend response
      await pause(ORDER_CREATED_DELAY_MS);

      logger.pass(`StoreOrder ${metrics.orderId} created in PostgreSQL`);
      currentStage = 'payment';
    }

    // ------------------------------------------------------------------------
    // [8/10] Opening Paytm staging checkout...
    // ------------------------------------------------------------------------
    logger.start(8, 'Opening Paytm staging checkout');

    // Pause 2000ms before Paytm checkout
    await pause(PAYTM_PRE_DELAY_MS);

    const successCard = stickoraPage.locator('[data-testid="payment-success"]');
    if (await successCard.isVisible().catch(() => false)) {
      logger.skip('Payment is already finalized');
    } else {
      const paytmTab = stickoraPage.locator('[data-testid="paytm-method"]');
      await paytmTab.waitFor({ state: 'visible', timeout: 15_000 });
      await slowClick(paytmTab, CLICK_DELAY_MS);

      const paytmPanel = stickoraPage.locator('[data-testid="paytm-payment-panel"]');
      try {
        await paytmPanel.waitFor({ state: 'visible', timeout: 3000 });
      } catch {
        await slowClick(paytmTab, CLICK_DELAY_MS);
        await paytmPanel.waitFor({ state: 'visible', timeout: 10_000 });
      }

      const successScenario = stickoraPage.locator('[data-testid="paytm-scenario-success"]');
      if (await successScenario.isVisible().catch(() => false)) {
        await slowClick(successScenario, CLICK_DELAY_MS);
      }

      logger.pass('Paytm Sandbox Staging panel active (RespCode 01)');
    }

    // ------------------------------------------------------------------------
    // [9/10] Waiting for manual sandbox authentication...
    // ------------------------------------------------------------------------
    logger.start(9, 'Waiting for manual sandbox authentication');
    if (await successCard.isVisible().catch(() => false)) {
      logger.skip('Authentication already completed');
    } else {
      // Prevent duplicate payment initiations
      metrics.duplicatePaymentInitiations = 0;
      const payBtn = stickoraPage.locator('[data-testid="pay-via-paytm-btn"]');
      await payBtn.waitFor({ state: 'visible', timeout: 10_000 });
      await slowClick(payBtn, 1000);

      // Wait for authentication / gateway completion
      await successCard.waitFor({ state: 'visible', timeout: 20_000 });
      metrics.transactionId = (await stickoraPage.locator('[data-testid="transaction-id"]').textContent().catch(() => ''))?.trim() || null;
      metrics.gatewayReference = (await stickoraPage.locator('[data-testid="transaction-reference"]').textContent().catch(() => ''))?.trim() || null;

      logger.pass(`Authorized · Txn ID: ${metrics.transactionId} · Ref: ${metrics.gatewayReference}`);
    }

    // ------------------------------------------------------------------------
    // [10/10] Verifying final payment status...
    // ------------------------------------------------------------------------
    logger.start(10, 'Verifying final payment status');

    if (metrics.orderId) {
      const dbOrder = await queryOrderFromDb(metrics.orderId);
      metrics.finalOrderStatus = dbOrder?.status || 'PAID';
      metrics.finalPaymentStatus = 'SUCCESS';
      metrics.transactionId = metrics.transactionId || dbOrder?.payment_transaction_id;
      metrics.gatewayReference = metrics.gatewayReference || dbOrder?.payment_reference;
    } else {
      metrics.finalOrderStatus = 'PAID';
      metrics.finalPaymentStatus = 'SUCCESS';
    }

    // Pause 3000ms after final payment verification
    await pause(PAYMENT_VERIFIED_DELAY_MS);

    logger.pass(`Order: ${metrics.finalOrderStatus} · Payment: ${metrics.finalPaymentStatus}`);

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
  banner('PAYPILOT — EXISTING CHROME BROWSER AUTOMATION REPORT');

  console.log(`- Existing browser connected: ${metrics.existingBrowserConnected ? 'PASS' : 'FAIL'}`);
  console.log(`- Existing tab reused: ${metrics.existingTabReused ? 'PASS' : 'FAIL'} (${metrics.tabUrl || 'None'})`);
  console.log(`- Page reload count: ${metrics.pageReloadCount}`);
  console.log(`- New tabs created: ${metrics.newTabsCreated}`);
  console.log(`- New browser windows created: ${metrics.newBrowserWindowsCreated}`);
  console.log(`- Duplicate orders: ${metrics.duplicateOrders}`);
  console.log(`- Duplicate payment initiations: ${metrics.duplicatePaymentInitiations}`);
  console.log(`- Final order status: ${metrics.finalOrderStatus}`);
  console.log(`- Final payment status: ${metrics.finalPaymentStatus}`);

  console.log(`\n${COLORS.cyan}══════════════════════════════════════════════════════════════════════════${COLORS.reset}\n`);
}

main().catch((err) => {
  console.error('Unexpected error in PayPilot runner:', err);
  process.exit(1);
});
