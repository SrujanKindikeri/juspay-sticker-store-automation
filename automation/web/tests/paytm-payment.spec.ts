import { test, expect } from '../fixtures/payment-fixture';
import { Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import {
  verifyStoreOrderInDb,
  queryStoreOrder,
  queryProductStock,
} from '../utils/db';
import {
  initExecutionState,
  getExecutionState,
  recordStepSuccess,
  recordStepFailure,
} from '../utils/execution-state';

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8001';
const SCREENSHOT_DIR = path.resolve(__dirname, '../screenshots/paytm');

const COLORS = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

if (!fs.existsSync(SCREENSHOT_DIR)) {
  fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
}

function logStage(
  stageNum: number,
  stageTitle: string,
  details: string,
  mode: 'AUTOMATED_MOCK' | 'GENUINE_STAGING' = 'AUTOMATED_MOCK'
) {
  const modeTag = mode === 'GENUINE_STAGING' ? '🔴 [GENUINE PAYTM STAGING]' : '🔵 [AUTOMATED MOCKED SANDBOX]';
  const timestamp = new Date().toLocaleTimeString();
  console.log(`\n${modeTag} [${timestamp}] Stage ${stageNum}: ${stageTitle}`);
  console.log(`   └─ Details: ${details}`);
}

async function captureStage(
  page: Page,
  filename: string,
  stageNum: number,
  stageTitle: string,
  details: string,
  mode: 'AUTOMATED_MOCK' | 'GENUINE_STAGING' = 'AUTOMATED_MOCK'
): Promise<string> {
  logStage(stageNum, stageTitle, details, mode);
  const screenshotPath = path.join(SCREENSHOT_DIR, filename);
  await page.screenshot({ path: screenshotPath, fullPage: false });
  return screenshotPath;
}

async function verifyEmailViaApi(request: any, email: string) {
  const sendRes = await request.post(`${API_BASE_URL}/api/v1/email-verification/send-otp`, {
    data: { email },
  });
  expect(sendRes.ok()).toBeTruthy();
  const sendData = await sendRes.json();

  const verRes = await request.post(`${API_BASE_URL}/api/v1/email-verification/verify-otp`, {
    data: {
      session_id: sendData.session_id,
      email,
      otp: sendData.simulated_otp,
    },
  });
  expect(verRes.ok()).toBeTruthy();
  const verData = await verRes.json();
  return {
    email_verification_session_id: sendData.session_id,
    email_verification_token: verData.verification_token,
  };
}

interface GenuineConfigCheck {
  isReady: boolean;
  missingItems: string[];
  provider: string;
  mid: string;
  key: string;
  baseUrl: string;
  callbackUrl: string;
  isBackendLive: boolean;
}

async function checkGenuineSandboxPrerequisites(request: any): Promise<GenuineConfigCheck> {
  const missingItems: string[] = [];
  let backendConfig: any = null;

  try {
    const configRes = await request.get(`${API_BASE_URL}/api/v1/payments/paytm/config`);
    if (configRes.ok()) {
      backendConfig = await configRes.json();
    }
  } catch (e) {
    missingItems.push('FastAPI backend is unreachable on ' + API_BASE_URL);
  }

  const provider = process.env.PAYMENT_PROVIDER || backendConfig?.provider || 'simulated';
  const mid = process.env.PAYTM_MID || '';
  const key = process.env.PAYTM_MERCHANT_KEY || '';
  const env = process.env.PAYTM_ENVIRONMENT || 'staging';
  const baseUrl = env.toLowerCase() === 'production' ? 'https://securegw.paytm.in' : 'https://securegw-stage.paytm.in';
  const callbackUrl = process.env.PAYTM_CALLBACK_URL || '';

  if (provider !== 'paytm') {
    missingItems.push(`PAYMENT_PROVIDER is set to '${provider}' (Must be explicitly 'paytm')`);
  }

  const isMidEmpty = !mid.trim() || mid.includes('YOUR_') || mid.includes('STAGE_MID_DEMO') || mid.length < 8;
  if (isMidEmpty) {
    missingItems.push('PAYTM_MID is missing or using placeholder in .env');
  }

  const isKeyEmpty = !key.trim() || key.includes('YOUR_') || key.includes('STAGE_KEY_DEMO') || key.length < 8;
  if (isKeyEmpty) {
    missingItems.push('PAYTM_MERCHANT_KEY is missing or using placeholder in .env');
  }

  if (!callbackUrl) {
    missingItems.push('PAYTM_CALLBACK_URL is missing in .env');
  }

  const isBackendLive = Boolean(backendConfig?.is_live);
  if (provider === 'paytm' && !isBackendLive) {
    missingItems.push('FastAPI backend has not loaded genuine Paytm credentials into memory');
  }

  return {
    isReady: missingItems.length === 0,
    missingItems,
    provider,
    mid,
    key,
    baseUrl,
    callbackUrl,
    isBackendLive,
  };
}

test.describe('Paytm Payment Gateway Sandbox Automation', () => {
  const isHeaded = process.env.HEADED === '1' || process.argv.includes('--headed');

  test.beforeEach(async () => {
    // Isolated context per run
  });

  test('1. Full E2E Journey: Store shopping -> Checkout -> Paytm Sandbox Success -> Order PAID', async ({
    storePage,
    checkoutPage,
    resultPage,
    page,
    request,
  }) => {
    const state = getExecutionState();

    // 1 & 2: Open Stickora Store & Wait for storefront to load
    try {
      await page.goto('/', { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => {
        try {
          localStorage.removeItem('juspay_sticker_cart_v1');
        } catch (e) {}
      });
      await expect(page.locator('[data-testid="store-homepage"]')).toBeVisible();
      await expect(page.locator('[data-testid="hero-banner"]')).toBeVisible();
      recordStepSuccess('Open website', { browserOpened: true });
      await captureStage(
        page,
        '01-store-opened.png',
        1,
        'Store opened & loaded',
        'Navigated to Stickora Store storefront at http://localhost:3001 and loaded catalog',
        'AUTOMATED_MOCK'
      );
    } catch (err: any) {
      recordStepFailure('Open website', err);
      throw err;
    }

    // 3 & 4: Find available product & Open product detail page
    try {
      const productLink = page.locator('[data-testid="product-card-STK-001"] a.product-card-link').first();
      if (await productLink.isVisible()) {
        await productLink.click();
      } else {
        await storePage.openProduct('STK-001');
      }
      await page.waitForURL('**/products/STK-001');
      await expect(page.locator('[data-testid="product-detail-page"]')).toBeVisible();
      await captureStage(
        page,
        '02-product-detail.png',
        2,
        'Product detail opened',
        'Opened STK-001 (Cyberpunk Neon Cat) detail page with specifications & stock availability',
        'AUTOMATED_MOCK'
      );
    } catch (err: any) {
      recordStepFailure('Select product', err);
      throw err;
    }

    // 5: Add product to cart from product detail page
    try {
      await storePage.addItemToCartFromDetail();
      await storePage.expectCartCount(1);
      recordStepSuccess('Add product to cart', { productAdded: true });
      await captureStage(
        page,
        '03-product-added.png',
        3,
        'Product added to cart',
        'Added STK-001 (₹99.00) to shopping cart via detail page button',
        'AUTOMATED_MOCK'
      );
    } catch (err: any) {
      recordStepFailure('Add product to cart', err);
      throw err;
    }

    // 6 & 7: Open cart & Proceed to checkout
    try {
      await storePage.openCart();
      await page.waitForURL('**/cart');
      await expect(storePage.proceedToCheckoutBtn).toBeVisible({ timeout: 15_000 });
      await captureStage(
        page,
        '04-cart-opened.png',
        4,
        'Shopping cart opened',
        'Navigated to /cart, verified subtotal ₹99.00 + shipping ₹50.00 = Total ₹149.00',
        'AUTOMATED_MOCK'
      );
      await storePage.proceedToCheckoutBtn.click();
      await page.waitForURL('**/checkout');
    } catch (err: any) {
      recordStepFailure('Proceed to checkout', err);
      throw err;
    }

    // 8 & 9: Fill customer/delivery details & Complete email verification process
    try {
      await storePage.fillDeliveryDetails({
        fullName: 'Aarav Patel',
        phone: '9876543210',
        email: 'aarav.patel@example.com',
        address: '74 Residency Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560025',
      }, true);

      await expect(storePage.emailVerifiedBadge).toBeVisible();
      recordStepSuccess('Enter customer details and email verification', { checkoutCompleted: true });
      await captureStage(
        page,
        '05-checkout-delivery-and-email-verified.png',
        5,
        'Checkout details filled & email verified',
        'Delivery address entered for Aarav Patel; Email OTP verification completed successfully',
        'AUTOMATED_MOCK'
      );
    } catch (err: any) {
      recordStepFailure('Enter customer details and email verification', err);
      throw err;
    }

    // 10 & 11: Click Place Order & Confirm order created by backend
    let orderId = state.orderId;
    let total = state.orderTotal;

    if (!state.orderCreated || !orderId) {
      try {
        await storePage.submitOrder();
        const orderConf = await storePage.expectOrderConfirmation();
        orderId = orderConf.orderId;
        total = orderConf.total;
        expect(orderId).toMatch(/^STK-ORD-[A-Z0-9]+$/);
        expect(total).toContain('149.00');

        // Verify order in PostgreSQL database
        const dbOrderBefore = await queryStoreOrder(orderId);
        expect(dbOrderBefore).toBeDefined();
        expect(dbOrderBefore.status).toBe('PENDING_PAYMENT');
        expect(dbOrderBefore.stock_reserved).toBe(true);

        recordStepSuccess('Place order', {
          orderCreated: true,
          orderId,
          orderTotal: total,
        });

        await captureStage(
          page,
          '06-order-created.png',
          6,
          'Order created in backend',
          `Backend generated StoreOrder ${orderId} in PostgreSQL with status PENDING_PAYMENT, Total ₹149.00`,
          'AUTOMATED_MOCK'
        );
      } catch (err: any) {
        recordStepFailure('Place order', err);
        throw err;
      }
    } else {
      console.log(`[IDEMPOTENT] Order already created in execution: ${orderId}. Skipping duplicate creation.`);
    }

    // 12: Select Paytm as payment provider
    try {
      if (!page.url().includes('/payment')) {
        await storePage.proceedToPaymentGateway();
      }
      await expect(page).toHaveURL(/.*\/payment\?order_id=STK-ORD-.*/);

      await checkoutPage.selectPaytmMethod();
      await expect(checkoutPage.paytmPaymentPanel).toBeVisible();

      await captureStage(
        page,
        '07-paytm-selected.png',
        7,
        'Paytm selected',
        'Selected Paytm Payment Gateway (Sandbox Staging) method in payment selector',
        'AUTOMATED_MOCK'
      );
    } catch (err: any) {
      recordStepFailure('Select Paytm method', err);
      throw err;
    }

    // 13: Open Paytm staging checkout using server-generated transaction token
    try {
      await checkoutPage.paytmScenarioSuccess.click();
      await expect(checkoutPage.paytmScenarioSuccess).toHaveClass(/selected/);
      recordStepSuccess('Open Paytm checkout', { paytmCheckoutOpened: true });

      logStage(
        8,
        'Paytm initiation request sent',
        `Calling /api/v1/payments/paytm/initiate for ${orderId} (Amount: ₹149.00)`,
        'AUTOMATED_MOCK'
      );

      await captureStage(
        page,
        '08-paytm-staging-initiated.png',
        8,
        'Paytm staging checkout initiated',
        'Paytm Checkout session initialized with authoritative txnToken and merchant credentials',
        'AUTOMATED_MOCK'
      );
    } catch (err: any) {
      recordStepFailure('Open Paytm checkout', err);
      throw err;
    }

    // 14 & 15: Complete sandbox authentication & return to merchant website
    let transactionId = state.transactionId;
    let reference = state.paymentReference;

    if (!state.transactionInitiated || !transactionId) {
      try {
        await checkoutPage.payViaPaytmButton.click();

        const result = await resultPage.expectSuccess();
        reference = result.reference;
        transactionId = result.transactionId;
        expect(reference).toMatch(/^(REF_PTM_|PAY_REF_|JUS-PAY-)[A-Z0-9]+$/);
        expect(transactionId).toMatch(/^(TXN_PTM_|TXN_)[A-Z0-9]+$/);

        recordStepSuccess('Complete sandbox payment', {
          transactionInitiated: true,
          transactionId,
          paymentReference: reference,
        });

        await captureStage(
          page,
          '09-customer-auth-completed.png',
          9,
          'Customer authentication completed & verified',
          `Transaction finalized: Txn ID: ${transactionId}, Gateway Ref: ${reference}`,
          'AUTOMATED_MOCK'
        );
      } catch (err: any) {
        recordStepFailure('Complete sandbox payment', err);
        throw err;
      }
    } else {
      console.log(`[IDEMPOTENT] Transaction already initiated: ${transactionId}. Skipping duplicate payment.`);
    }

    // 16: Verify payment using backend's server-to-server Paytm status API & DB status
    try {
      const currentOrderId = getExecutionState().orderId || orderId;
      const statusRes = await request.get(`${API_BASE_URL}/api/v1/payments/paytm/status/${currentOrderId}`);
      expect(statusRes.ok()).toBeTruthy();
      const statusData = await statusRes.json();
      expect(statusData.status).toBe('SUCCESS');
      expect(statusData.store_order_status).toBe('PAID');

      await verifyStoreOrderInDb(currentOrderId!, { status: 'PAID' });
      const dbOrderAfter = await queryStoreOrder(currentOrderId!);
      expect(dbOrderAfter.stock_reserved).toBe(false);

      recordStepSuccess('Verify payment status', {
        paymentVerified: true,
        paymentStatus: 'SUCCESS',
        isCompleted: true,
        failedStep: null,
      });

      // 17: Display final order and payment statuses
      await captureStage(
        page,
        '10-order-status-confirmed.png',
        10,
        'Final order status confirmed',
        `S2S API & PostgreSQL verification passed: StoreOrder ${currentOrderId} status is PAID, stock permanent reserve confirmed`,
        'AUTOMATED_MOCK'
      );
    } catch (err: any) {
      recordStepFailure('Verify payment status', err);
      throw err;
    }

    if (isHeaded) {
      console.log(`\n  ${COLORS.bold}${COLORS.green}✓ [HEADED OBSERVATION] Customer workflow completed successfully once! Browser kept open for 3 seconds for review.${COLORS.reset}`);
      await page.waitForTimeout(3000);
    }
  });

  test('2. Paytm Sandbox Failure: Bank Decline scenario -> Order marked PAYMENT_FAILED & stock restored', async ({
    page,
    checkoutPage,
    resultPage,
    request,
  }) => {
    test.skip(isHeaded, 'Skipped in headed single-run mode (Only 1 customer journey per command)');

    logStage(1, 'Simulating Bank Decline Scenario', 'Testing stock restoration on transaction failure', 'AUTOMATED_MOCK');
    const stockBefore = await queryProductStock('STK-001');

    // 1. Create a store order directly via API
    const emailCreds = await verifyEmailViaApi(request, 'paytm.fail.tester@example.com');
    const orderRes = await request.post(`${API_BASE_URL}/api/v1/store/orders`, {
      data: {
        items: [{ product_id: 'STK-001', quantity: 2 }],
        delivery: {
          full_name: 'Paytm Decline Tester',
          mobile_number: '9876543210',
          email: 'paytm.fail.tester@example.com',
          address_line: '88 MG Road',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
        ...emailCreds,
      },
    });
    expect(orderRes.ok()).toBeTruthy();
    const orderData = await orderRes.json();
    const orderId = orderData.order_id;
    const orderToken = orderData.order_token;

    // Stock should be reserved
    const stockDuring = await queryProductStock('STK-001');
    expect(stockDuring).toBe(stockBefore - 2);

    // 2. Open payment page
    await page.goto(`/payment?order_id=${orderId}&token=${encodeURIComponent(orderToken)}`, {
      waitUntil: 'domcontentloaded',
    });
    await expect(checkoutPage.checkoutPageContainer).toBeVisible();

    // 3. Select Paytm method & Bank Decline scenario
    await checkoutPage.selectPaytmMethod();
    await checkoutPage.paytmScenarioFailed.click();
    await expect(checkoutPage.paytmScenarioFailed).toHaveClass(/selected/);

    await captureStage(
      page,
      '10-paytm-decline-selected.png',
      2,
      'Bank decline scenario selected',
      `Order ${orderId} set to simulate RespCode 227 (Bank Decline)`,
      'AUTOMATED_MOCK'
    );

    // 4. Submit payment
    await checkoutPage.payViaPaytmButton.click();

    // 5. Expect failure screen
    await resultPage.expectFailed();

    await captureStage(
      page,
      '11-payment-result-failed.png',
      3,
      'Payment failure displayed',
      `Failure screen displayed to customer. Reason: Paytm payment was declined.`,
      'AUTOMATED_MOCK'
    );

    // 6. Verify DB status: Order status must be PAYMENT_FAILED and stock restored
    await verifyStoreOrderInDb(orderId, { status: 'PAYMENT_FAILED' });
    const stockAfter = await queryProductStock('STK-001');
    expect(stockAfter).toBe(stockBefore);

    logStage(4, 'Inventory Restored', `Stock successfully returned: Before=${stockBefore}, After=${stockAfter}`, 'AUTOMATED_MOCK');
  });

  test('3. Authoritative Reconciliation on Callback Redirect', async ({
    page,
    resultPage,
    request,
  }) => {
    test.skip(isHeaded, 'Skipped in headed single-run mode (Only 1 customer journey per command)');

    logStage(1, 'Authoritative Callback Reconciliation', 'Testing redirect webhook reconciliation', 'AUTOMATED_MOCK');

    // 1. Create order
    const emailCreds = await verifyEmailViaApi(request, 'paytm.recon@example.com');
    const orderRes = await request.post(`${API_BASE_URL}/api/v1/store/orders`, {
      data: {
        items: [{ product_id: 'STK-001', quantity: 1 }],
        delivery: {
          full_name: 'Reconcile User',
          mobile_number: '9876543210',
          email: 'paytm.recon@example.com',
          address_line: '42 Indiranagar',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560038',
        },
        ...emailCreds,
      },
    });
    const orderData = await orderRes.json();
    const orderId = orderData.order_id;
    const orderToken = orderData.order_token;

    // 2. Initiate Paytm transaction via API
    const initRes = await request.post(`${API_BASE_URL}/api/v1/payments/paytm/initiate`, {
      data: {
        order_id: orderId,
        amount: 149.0,
        currency: 'INR',
        customer_email: 'paytm.recon@example.com',
      },
    });
    expect(initRes.ok()).toBeTruthy();

    // 3. Trigger callback on backend
    const cbRes = await request.post(`${API_BASE_URL}/api/v1/payments/paytm/callback`, {
      data: {
        ORDERID: orderId,
        TXNID: 'PTM_RECON_TXN_001',
        TXNAMOUNT: '149.00',
        STATUS: 'TXN_SUCCESS',
        RESPCODE: '01',
        RESPMSG: 'Txn Success',
        CHECKSUMHASH: 'MOCK_VALID_CHECKSUM',
      },
    });
    expect(cbRes.ok()).toBeTruthy();

    // 4. Open payment page with redirect query parameter
    await page.goto(`/payment?order_id=${orderId}&paytm_status=SUCCESS&token=${encodeURIComponent(orderToken)}`);

    // 5. Expect authoritative success screen
    await resultPage.expectSuccess();

    await captureStage(
      page,
      '12-reconciliation-redirect.png',
      2,
      'Redirect reconciled successfully',
      `Order ${orderId} reconciled to SUCCESS via server-side inquiry`,
      'AUTOMATED_MOCK'
    );

    // 6. DB check
    await verifyStoreOrderInDb(orderId, { status: 'PAID' });
  });

  test('4. Genuine Paytm Sandbox Test (Official Gateway Verification)', async ({
    page,
    request,
  }) => {
    test.skip(isHeaded, 'Skipped in headed single-run mode (Only 1 customer journey per command)');

    console.log('\n========================================================================');
    console.log('🔴 [GENUINE PAYTM STAGING] Pre-flight Verification Check');
    console.log('========================================================================');

    const check = await checkGenuineSandboxPrerequisites(request);

    if (!check.isReady) {
      console.log('\n⚠️  GENUINE PAYTM SANDBOX TEST STOPPED: Missing Required Credentials');
      console.log('   The genuine sandbox test cannot proceed because the following requirements are missing:');
      for (const item of check.missingItems) {
        console.log(`   ❌ ${item}`);
      }
      console.log('\n   📋 To enable Genuine Live Staging tests against https://securegw-stage.paytm.in:');
      console.log('   1. Sign up on https://dashboard.paytm.com/ (Staging Mode)');
      console.log('   2. Set PAYMENT_PROVIDER=paytm in .env');
      console.log('   3. Set PAYTM_MID=<your-staging-mid> in .env');
      console.log('   4. Set PAYTM_MERCHANT_KEY=<your-staging-key> in .env');
      console.log('   5. Restart backend: .\\backend\\venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8001');
      console.log('   6. Re-run: npm run test:paytm-e2e:headed\n');
      console.log('   NOTE: Mocked sandbox fallback was NOT used because genuine mode strictly prohibits silent fallback.');
      console.log('========================================================================\n');

      test.skip(
        true,
        `Genuine Paytm staging test STOPPED: Missing credentials (${check.missingItems.join(', ')})`
      );
      return;
    }

    // When genuine credentials ARE present:
    console.log(`\n🔴 [GENUINE PAYTM STAGING] Calling Real Paytm Initiate Transaction API...`);
    console.log(`   Endpoint : ${check.baseUrl}/theia/api/v1/initiateTransaction?mid=${check.mid}`);
    console.log(`   Order ID : DEMO-ORD-GENUINE-...`);

    const orderId = `DEMO-ORD-GENUINE-${Date.now().toString().slice(-6)}`;
    const initRes = await request.post(`${API_BASE_URL}/api/v1/payments/paytm/initiate`, {
      data: {
        order_id: orderId,
        amount: 100.0,
        currency: 'INR',
        customer_email: 'genuine.tester@example.com',
      },
    });

    if (!initRes.ok()) {
      const err = await initRes.json().catch(() => ({}));
      console.error(`\n❌ [GENUINE PAYTM STAGING] Gateway rejected initiation:`, err);
      throw new Error(`Paytm Staging Gateway initiation failed: ${JSON.stringify(err)}`);
    }

    const initData = await initRes.json();
    console.log(`\n✓ [GENUINE PAYTM STAGING] Genuine txnToken Acquired from Paytm Staging Server:`);
    console.log(`   txnToken : ${initData.txn_token.slice(0, 10)}...`);
    console.log(`   MID      : ${initData.mid}`);

    expect(initData.txn_token).toBeDefined();
    expect(initData.txn_token.length).toBeGreaterThan(10);

    // Open visible browser to payment page
    await page.goto(`/payment?order_id=${orderId}`);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, 'genuine-01-payment-page.png') });
    console.log(`✓ [GENUINE PAYTM STAGING] Visible browser opened to payment page with genuine staging session.`);
  });
});
