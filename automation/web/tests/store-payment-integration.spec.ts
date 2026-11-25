import { test, expect } from '../fixtures/payment-fixture';
import {
  verifyStoreOrderInDb,
  queryStoreOrder,
  queryProductStock,
  expireTransactionOtpInDb,
  verifyTransactionInDb,
  getPool,
} from '../utils/db';

const API_BASE_URL = process.env.API_BASE_URL || 'http://127.0.0.1:8001';

test.describe('Phase 8: Physical Sticker Store & JUSPAY Gateway Integration', () => {
  test.beforeEach(async ({ page }) => {
    // Clear cart before each test
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('juspay_sticker_cart_v1'));
  });

  test('1. Complete shopping journey using Card payment -> Order PAID & DB verified', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    // 1. Browse catalogue & add STK-001 (₹99.00)
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.expectCartCount(1);

    // 2. Open cart and proceed to checkout
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    // 3. Fill delivery details & place order
    await storePage.fillDeliveryDetails({
      fullName: 'Vikram Malhotra',
      phone: '9876543210',
      email: 'vikram.malhotra@example.com',
      address: 'Plot 42, Silicon Valley Layout',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560100',
    });
    await storePage.submitOrder();

    // 4. Verify Order Confirmation Screen
    const { orderId, total } = await storePage.expectOrderConfirmation();
    expect(orderId).toMatch(/^STK-ORD-[A-Z0-9]+$/);
    expect(total).toContain('149.00');

    // 5. Click "Pay Now with JUSPAY Gateway"
    await storePage.proceedToPaymentGateway();
    await expect(page).toHaveURL(/.*\/payment\?order_id=STK-ORD-.*/);

    // 6. On payment page, verify authoritative amount and order details
    await expect(checkoutPage.orderAmount).toContainText('149.00');

    // 7. Pay with Card
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'VIKRAM MALHOTRA',
    });
    await checkoutPage.submitPayment();

    // 8. Verify OTP
    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();

    // 9. Verify Success Result Page
    const { reference, transactionId } = await resultPage.expectSuccess();
    expect(reference).toMatch(/^(PAY_REF_|JUS-PAY-)[A-Z0-9]+$/);
    expect(transactionId).toMatch(/^TXN_[A-Z0-9]+$/);

    // Verify Order status pill on result page shows PAID
    await expect(resultPage.orderStatusBadge).toContainText('PAID');
    await expect(page.locator('[data-testid="order-delivery-recap"]')).toContainText('Vikram Malhotra');

    // 10. Database verification
    const dbOrder = await verifyStoreOrderInDb(orderId, {
      status: 'PAID',
      subtotal: 99.0,
      deliveryFee: 50.0,
      totalAmount: 149.0,
    });
    expect(dbOrder.status).toBe('PAID');
    expect(dbOrder.stock_reserved).toBe(false);
    expect(dbOrder.payment_transaction_id).toBe(transactionId);
    expect(dbOrder.payment_reference).toBe(reference);

    const dbTxn = await verifyTransactionInDb(
      { transactionId },
      {
        status: 'SUCCESS',
        amount: 149.0,
        paymentMethod: 'CARD',
      }
    );
    expect(dbTxn.order_id).toBe(orderId);
  });

  test('2. Complete shopping journey using UPI payment -> Order PAID & DB verified', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    // 1. Browse catalogue & add STK-002 (₹129.00)
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-002');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    // 2. Checkout
    await storePage.fillDeliveryDetails({
      fullName: 'Pooja Hegde',
      phone: '9123456789',
      email: 'pooja.hegde@example.com',
      address: 'Flat 12B, Green Meadows',
      city: 'Mumbai',
      state: 'Maharashtra',
      pincode: '400001',
    });
    await storePage.submitOrder();

    const { orderId } = await storePage.expectOrderConfirmation();

    // 3. Navigate to Payment Gateway
    await storePage.proceedToPaymentGateway();

    // 4. Select UPI and pay
    await checkoutPage.selectUpiMethod();
    await checkoutPage.fillUpiDetails({ upiId: 'pooja@okhdfcbank' });
    await checkoutPage.submitPayment();

    // 5. Verify OTP
    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();

    // 6. Verify result
    const { transactionId } = await resultPage.expectSuccess();
    await expect(resultPage.orderStatusBadge).toContainText('PAID');

    // 7. Verify DB
    const dbOrder = await verifyStoreOrderInDb(orderId, { status: 'PAID' });
    expect(dbOrder.payment_transaction_id).toBe(transactionId);
  });

  test('3. Complete shopping journey using Net Banking payment -> Order PAID & DB verified', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    // 1. Add STK-003 (₹149.00)
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-003');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    // 2. Checkout
    await storePage.fillDeliveryDetails({
      fullName: 'Arjun Das',
      phone: '9845123456',
      email: 'arjun.das@example.com',
      address: '24 Anna Salai',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600002',
    });
    await storePage.submitOrder();

    const { orderId } = await storePage.expectOrderConfirmation();

    // 3. Navigate to Payment Gateway
    await storePage.proceedToPaymentGateway();

    // 4. Select Net Banking and pay
    await checkoutPage.selectNetBankingMethod();
    await checkoutPage.selectBank('HDFC');
    await checkoutPage.submitPayment();

    // 5. Verify OTP
    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();

    // 6. Verify result
    const { transactionId } = await resultPage.expectSuccess();
    await expect(resultPage.orderStatusBadge).toContainText('PAID');

    // 7. Verify DB
    const dbOrder = await verifyStoreOrderInDb(orderId, { status: 'PAID' });
    expect(dbOrder.payment_transaction_id).toBe(transactionId);
  });

  test('4. Invalid OTP does not update order to PAID', async ({
    storePage,
    checkoutPage,
    otpPage,
    page,
  }) => {
    // 1. Create order
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    await storePage.fillDeliveryDetails({
      fullName: 'Dev Tester',
      phone: '9876543210',
      email: 'tester@example.com',
      address: '10 Test Lane',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500081',
    });
    await storePage.submitOrder();

    const { orderId } = await storePage.expectOrderConfirmation();
    await storePage.proceedToPaymentGateway();

    // 2. Submit payment
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'DEV TESTER',
    });
    await checkoutPage.submitPayment();

    // 3. Enter wrong OTP
    await otpPage.waitForOtpPage();
    await otpPage.enterOtp('000000');
    await otpPage.clickVerifyOtp();

    // 4. Expect error banner
    await expect(otpPage.otpErrorBanner).toBeVisible();
    await expect(otpPage.otpErrorBanner).toContainText('Invalid OTP');

    // 5. DB order must still be PENDING_PAYMENT
    const dbOrder = await verifyStoreOrderInDb(orderId, { status: 'PENDING_PAYMENT' });
    expect(dbOrder.status).toBe('PENDING_PAYMENT');
  });

  test('5. Expired OTP fails transaction and does not mark order as PAID', async ({
    storePage,
    checkoutPage,
    otpPage,
    page,
  }) => {
    // 1. Create order
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    await storePage.fillDeliveryDetails({
      fullName: 'Expire Test User',
      phone: '9876543210',
      email: 'expire@example.com',
      address: '11 Expiry Ave',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    });
    await storePage.submitOrder();

    const { orderId } = await storePage.expectOrderConfirmation();
    await storePage.proceedToPaymentGateway();

    // 2. Submit payment
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'EXPIRE TESTER',
    });
    await checkoutPage.submitPayment();

    await otpPage.waitForOtpPage();
    const validOtp = await otpPage.getSimulatedOtp();

    // 3. Expire OTP directly in PostgreSQL
    const pool = getPool();
    const txnRes = await pool.query(
      'SELECT transaction_id FROM payment_transactions WHERE order_id = $1 ORDER BY id DESC LIMIT 1',
      [orderId]
    );
    const txnId = txnRes.rows[0].transaction_id;
    await expireTransactionOtpInDb(txnId);

    // 4. Attempt to verify expired OTP
    await otpPage.enterOtp(validOtp);
    await otpPage.clickVerifyOtp();

    // 5. Verify failed state
    await resultPage.expectFailed();
    await expect(resultPage.failureReason).toContainText(/expired/i);

    // 6. Order in DB must NOT be PAID
    const dbOrderAfter = await queryStoreOrder(orderId);
    expect(dbOrderAfter.status).not.toBe('PAID');
    expect(dbOrderAfter.status).toBe('PAYMENT_FAILED');
    expect(dbOrderAfter.stock_reserved).toBe(false);
  });

  test('6. Declined payment marks order as PAYMENT_FAILED and restores stock', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    // 1. Check stock before order
    const initialStock = await queryProductStock('STK-004');

    // 2. Create order with STK-004
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-004');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    await storePage.fillDeliveryDetails({
      fullName: 'Decline Tester',
      phone: '9876543210',
      email: 'decline.tester@example.com',
      address: '15 Decline Road',
      city: 'Kolkata',
      state: 'West Bengal',
      pincode: '700001',
    });
    await storePage.submitOrder();

    const { orderId } = await storePage.expectOrderConfirmation();

    // Stock should be reserved (initialStock - 1)
    const stockDuringOrder = await queryProductStock('STK-004');
    expect(stockDuringOrder).toBe(initialStock - 1);

    // 3. Navigate to Payment Gateway & trigger DECLINED scenario
    await storePage.proceedToPaymentGateway();

    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'SIMULATE DECLINE TESTER',
    });
    await checkoutPage.submitPayment();

    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();

    // 4. Verify Declined Result
    await resultPage.expectDeclined();
    await expect(resultPage.orderStatusBadge).toContainText('PAYMENT_FAILED');
    await expect(resultPage.retryPaymentButton).toBeVisible();

    // 5. DB Verification: order status is PAYMENT_FAILED, stock_reserved is false, and stock is RESTORED
    const dbOrder = await verifyStoreOrderInDb(orderId, { status: 'PAYMENT_FAILED' });
    expect(dbOrder.stock_reserved).toBe(false);

    const stockAfterDecline = await queryProductStock('STK-004');
    expect(stockAfterDecline).toBe(initialStock);
  });

  test('7. Failed payment marks order as PAYMENT_FAILED and restores stock', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    // 1. Check stock before order
    const initialStock = await queryProductStock('STK-005');

    // 2. Create order with STK-005
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-005');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    await storePage.fillDeliveryDetails({
      fullName: 'Fail Tester',
      phone: '9876543210',
      email: 'fail.tester@example.com',
      address: '20 Fail Lane',
      city: 'Delhi',
      state: 'Delhi',
      pincode: '110001',
    });
    await storePage.submitOrder();

    const { orderId } = await storePage.expectOrderConfirmation();

    // Stock reserved
    expect(await queryProductStock('STK-005')).toBe(initialStock - 1);

    // 3. Navigate to Payment Gateway & trigger FAILED scenario
    await storePage.proceedToPaymentGateway();

    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'SIMULATE FAIL TESTER',
    });
    await checkoutPage.submitPayment();

    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();

    // 4. Verify Failed Result
    await resultPage.expectFailed();
    await expect(resultPage.orderStatusBadge).toContainText('PAYMENT_FAILED');
    await expect(resultPage.retryPaymentButton).toBeVisible();

    // 5. DB Verification: order status is PAYMENT_FAILED, stock restored
    const dbOrder = await verifyStoreOrderInDb(orderId, { status: 'PAYMENT_FAILED' });
    expect(dbOrder.stock_reserved).toBe(false);

    const stockAfterFail = await queryProductStock('STK-005');
    expect(stockAfterFail).toBe(initialStock);
  });

  test('8. Customer safely retries a failed payment and completes it successfully', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    // 1. Create order
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-006');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    await storePage.fillDeliveryDetails({
      fullName: 'Retry Customer',
      phone: '9876543210',
      email: 'retry@example.com',
      address: '99 Recovery Court',
      city: 'Jaipur',
      state: 'Rajasthan',
      pincode: '302001',
    });
    await storePage.submitOrder();

    const { orderId } = await storePage.expectOrderConfirmation();
    await storePage.proceedToPaymentGateway();

    // 2. First attempt fails
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'SIMULATE FAIL',
    });
    await checkoutPage.submitPayment();

    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();
    await resultPage.expectFailed();

    // 3. Click "Retry Payment"
    await resultPage.clickRetryPayment();

    // Verify back to checkout step with order amount intact
    await expect(checkoutPage.orderAmount).toBeVisible();

    // 4. Second attempt succeeds using UPI
    await checkoutPage.selectUpiMethod();
    await checkoutPage.fillUpiDetails({ upiId: 'retry.customer@oksbi' });
    await checkoutPage.submitPayment();

    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();

    // 5. Success!
    await resultPage.expectSuccess();
    await expect(resultPage.orderStatusBadge).toContainText('PAID');

    // 6. DB order is now PAID
    const dbOrder = await verifyStoreOrderInDb(orderId, { status: 'PAID' });
    expect(dbOrder.status).toBe('PAID');
  });

  test('9. Multiple payment requests for an already paid order are rejected with HTTP 409', async ({
    page,
  }) => {
    // 1. Place store order via API
    const orderRes = await page.request.post(`${API_BASE_URL}/api/v1/store/orders`, {
      data: {
        items: [{ product_id: 'STK-001', quantity: 1 }],
        delivery: {
          full_name: 'Conflict Test',
          mobile_number: '9876543210',
          email: 'conflict@example.com',
          address_line: '1 Conflict St',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
      },
    });
    expect(orderRes.ok()).toBeTruthy();
    const orderData = await orderRes.json();
    const orderId = orderData.order_id;
    const totalAmount = orderData.total_amount;

    // 2. Initiate payment
    const initRes = await page.request.post(`${API_BASE_URL}/api/v1/payments/initiate`, {
      data: {
        order_id: orderId,
        amount: totalAmount,
        currency: 'INR',
        payment_method: 'CARD',
        customer_email: 'conflict@example.com',
        card_details: {
          card_number: '4111222233334444',
          expiry: '12/28',
          cvv: '123',
          card_holder: 'CONFLICT TEST',
        },
      },
    });
    expect(initRes.ok()).toBeTruthy();
    const initData = await initRes.json();

    // 3. Authenticate OTP
    const otpRes = await page.request.post(`${API_BASE_URL}/api/v1/payments/${initData.transaction_id}/send-otp`);
    const otpData = await otpRes.json();
    const verifyRes = await page.request.post(`${API_BASE_URL}/api/v1/payments/${initData.transaction_id}/verify-otp`, {
      data: { otp: otpData.simulated_otp },
    });
    expect(verifyRes.ok()).toBeTruthy();

    // 4. Process payment -> Order becomes PAID
    const processRes = await page.request.post(`${API_BASE_URL}/api/v1/payments/${initData.transaction_id}/process`);
    expect(processRes.ok()).toBeTruthy();

    const dbOrder = await verifyStoreOrderInDb(orderId, { status: 'PAID' });
    expect(dbOrder.status).toBe('PAID');

    // 5. Attempt second payment initiation on this PAID order -> Expect 409 Conflict
    const secondInitRes = await page.request.post(`${API_BASE_URL}/api/v1/payments/initiate`, {
      data: {
        order_id: orderId,
        amount: totalAmount,
        currency: 'INR',
        payment_method: 'UPI',
        customer_email: 'conflict@example.com',
        upi_details: { upi_id: 'conflict@okaxis' },
      },
    });
    expect(secondInitRes.status()).toBe(409);
    const conflictBody = await secondInitRes.json();
    expect(conflictBody.detail).toMatch(/already.*paid/i);
  });

  test('10. Tampered order amounts submitted to payment gateway are rejected with HTTP 400', async ({
    page,
  }) => {
    // 1. Create order for STK-001 (total: ₹149.00)
    const orderRes = await page.request.post(`${API_BASE_URL}/api/v1/store/orders`, {
      data: {
        items: [{ product_id: 'STK-001', quantity: 1 }],
        delivery: {
          full_name: 'Tamper Test',
          mobile_number: '9876543210',
          email: 'tamper@example.com',
          address_line: '1 Tamper Ave',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
      },
    });
    expect(orderRes.ok()).toBeTruthy();
    const orderData = await orderRes.json();
    const orderId = orderData.order_id;
    expect(orderData.total_amount).toBe(149.0);

    // 2. Submit payment initiation with tampered amount (e.g. ₹1.00 instead of ₹149.00)
    const tamperRes = await page.request.post(`${API_BASE_URL}/api/v1/payments/initiate`, {
      data: {
        order_id: orderId,
        amount: 1.0, // Tampered!
        currency: 'INR',
        payment_method: 'CARD',
        customer_email: 'tamper@example.com',
        card_details: {
          card_number: '4111222233334444',
          expiry: '12/28',
          cvv: '123',
          card_holder: 'TAMPER TEST',
        },
      },
    });

    expect(tamperRes.status()).toBe(400);
    const errBody = await tamperRes.json();
    expect(errBody.detail).toContain('Tampered amount rejected');
  });

  test('11. Unauthorized access to order details without valid token is blocked with 401/403', async ({
    page,
  }) => {
    // 1. Place an order to obtain order_id and order_token
    const orderRes = await page.request.post(`${API_BASE_URL}/api/v1/store/orders`, {
      data: {
        items: [{ product_id: 'STK-001', quantity: 1 }],
        delivery: {
          full_name: 'Security Test Customer',
          mobile_number: '9876543210',
          email: 'security@example.com',
          address_line: 'Secret Address 101',
          city: 'Bengaluru',
          state: 'Karnataka',
          pincode: '560001',
        },
      },
    });
    expect(orderRes.ok()).toBeTruthy();
    const orderData = await orderRes.json();
    const orderId = orderData.order_id;
    const orderToken = orderData.order_token;
    expect(orderToken).toBeDefined();

    // 2. Access WITHOUT token -> HTTP 401 Unauthorized
    const unauthRes = await page.request.get(`${API_BASE_URL}/api/v1/store/orders/${orderId}`);
    expect(unauthRes.status()).toBe(401);
    const unauthJson = await unauthRes.json();
    expect(unauthJson.detail).toContain('Order access token is required');

    // 3. Access WITH INVALID token -> HTTP 403 Forbidden
    const forbiddenRes = await page.request.get(
      `${API_BASE_URL}/api/v1/store/orders/${orderId}?token=invalid_forged_token_12345`
    );
    expect(forbiddenRes.status()).toBe(403);
    const forbiddenJson = await forbiddenRes.json();
    expect(forbiddenJson.detail).toContain('Invalid or expired order access token');

    // 4. Access WITH VALID token via query parameter -> HTTP 200 OK
    const authQueryRes = await page.request.get(
      `${API_BASE_URL}/api/v1/store/orders/${orderId}?token=${orderToken}`
    );
    expect(authQueryRes.status()).toBe(200);
    const authQueryJson = await authQueryRes.json();
    expect(authQueryJson.delivery.full_name).toBe('Security Test Customer');

    // 5. Access WITH VALID token via X-Order-Token header -> HTTP 200 OK
    const authHeaderRes = await page.request.get(`${API_BASE_URL}/api/v1/store/orders/${orderId}`, {
      headers: { 'X-Order-Token': orderToken },
    });
    expect(authHeaderRes.status()).toBe(200);
    const authHeaderJson = await authHeaderRes.json();
    expect(authHeaderJson.delivery.full_name).toBe('Security Test Customer');
  });

  test('12. Page refresh on payment result screen preserves order and payment state', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    // 1. Create order & complete payment
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    await storePage.fillDeliveryDetails({
      fullName: 'Refresh Test User',
      phone: '9876543210',
      email: 'refresh@example.com',
      address: '77 Memory Lane',
      city: 'Mysuru',
      state: 'Karnataka',
      pincode: '570001',
    });
    await storePage.submitOrder();

    const { orderId } = await storePage.expectOrderConfirmation();
    await storePage.proceedToPaymentGateway();

    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'REFRESH USER',
    });
    await checkoutPage.submitPayment();

    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();

    const { reference, transactionId } = await resultPage.expectSuccess();

    // 2. Reload the page
    await page.reload();

    // 3. Verify state is preserved authoritatively from backend
    await expect(resultPage.successCard).toBeVisible();
    await expect(resultPage.statusBadge).toContainText('SUCCESS');
    await expect(resultPage.orderStatusBadge).toContainText('PAID');
    await expect(resultPage.transactionId).toContainText(transactionId);
    await expect(resultPage.transactionReference).toContainText(reference);
    await expect(resultPage.orderId).toContainText(orderId);
  });
});
