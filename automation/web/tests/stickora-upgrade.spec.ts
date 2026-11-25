import { test, expect } from '../fixtures/payment-fixture';
import { verifyStoreOrderInDb } from '../utils/db';

test.describe('Stickora Checkout & JUSPAY Payment Gateway UI Upgrade', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('juspay_sticker_cart_v1'));
  });

  test('1. Branding, responsive two-column Checkout with thumbnails, JUSPAY gateway & full Receipt with Download', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    // 1. Verify Stickora branding on storefront
    await storePage.openHome();
    await expect(page.locator('[data-testid="store-logo"] .logo-brand')).toHaveText('Stickora');
    await expect(page.locator('[data-testid="store-logo"] .logo-badge')).toHaveText('Premium Vinyl Stickers');

    // 2. Add two stickers & navigate to Checkout
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.addItemToCartFromCard('STK-002');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    // Verify two-column Checkout UI & product thumbnails
    await expect(page.locator('[data-testid="stickora-checkout-shell"]')).toBeVisible();
    await expect(page.locator('.review-item-thumb img')).toHaveCount(2);
    await expect(storePage.checkoutSubtotal).toContainText('188.00');
    await expect(storePage.checkoutDeliveryFee).toContainText('50.00');
    await expect(storePage.checkoutTotal).toContainText('238.00');

    // Verify mobile checkout has zero horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    const hasOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasOverflow).toBe(false);
    await page.setViewportSize({ width: 1280, height: 800 });

    // 3. Place order & verify JUSPAY payment gateway branding + sandbox badge
    await storePage.fillDeliveryDetails({
      fullName: 'Ananya Verma',
      phone: '9876543210',
      email: 'ananya.verma@example.com',
      address: '21 Lavelle Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560001',
    });
    await storePage.submitOrder();

    const orderId = await storePage.waitForPaymentRedirect();
    await expect(page.locator('[data-testid="brand-logo-group"]')).toContainText('JUSPAY');
    await expect(page.locator('[data-testid="sandbox-mode-badge"]')).toBeVisible();
    await expect(page.locator('[data-testid="simulation-disclaimer"]')).toBeVisible();
    await expect(checkoutPage.orderSummary).toContainText('Stickora');
    await expect(checkoutPage.orderSummary).toContainText('Premium Vinyl Stickers');
    await expect(checkoutPage.orderAmount).toContainText('238.00');

    // 4. Complete Card payment & verify OTP
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'ANANYA VERMA',
    });
    await checkoutPage.submitPayment();

    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();

    // 5. Verify complete Payment Success Receipt
    const { reference, transactionId } = await resultPage.expectSuccess();
    await expect(resultPage.orderStatusBadge).toContainText('PAID');
    await expect(resultPage.transactionId).toContainText(transactionId);
    await expect(resultPage.transactionReference).toContainText(reference);
    await expect(resultPage.orderId).toContainText(orderId);
    await expect(resultPage.amountPaid).toContainText('238.00');
    await expect(resultPage.paymentMethod).toContainText('CARD');
    await expect(resultPage.finalizedAt).toBeVisible();

    // Verify delivery address and purchased items appear on receipt
    await expect(page.locator('[data-testid="order-delivery-recap"]')).toContainText('Ananya Verma');
    await expect(page.locator('[data-testid="order-delivery-recap"]')).toContainText('560001');
    await expect(page.locator('[data-testid="receipt-purchased-items"]')).toContainText('Cyberpunk Neon Cat');
    await expect(page.locator('[data-testid="receipt-purchased-items"]')).toContainText('Coffee First, Code Later');

    // Verify Download Receipt triggers file download
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="download-receipt-button"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain(`Stickora-Receipt-${orderId}`);

    // Verify Continue Shopping button navigates to /products
    await expect(page.locator('[data-testid="continue-shopping-btn"]')).toHaveAttribute('href', '/products');

    // 6. Verify PostgreSQL state
    const dbOrder = await verifyStoreOrderInDb(orderId, { status: 'PAID', totalAmount: 238.0 });
    expect(dbOrder.payment_transaction_id).toBe(transactionId);
  });

  test('2. Dedicated Pending Payment screen displays for unverified transaction and allows resuming or refreshing status', async ({
    storePage,
    checkoutPage,
    otpPage,
    page,
  }) => {
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCheckout();

    await storePage.fillDeliveryDetails({
      fullName: 'Pending Tester',
      phone: '9876543210',
      email: 'pending@example.com',
      address: '10 Pending Ave',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    });
    await storePage.submitOrder();

    const orderId = await storePage.waitForPaymentRedirect();
    await expect(checkoutPage.orderAmount).toContainText('149.00');

    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'PENDING USER',
    });
    await checkoutPage.submitPayment();
    await otpPage.waitForOtpPage();

    const txnId = (await page.locator('.otp-meta-chip code').first().textContent())?.trim() || '';
    expect(txnId).toMatch(/^TXN_/);

    // Navigate with transaction_id while backend status is still PENDING
    await page.goto(`/payment?order_id=${orderId}&transaction_id=${txnId}`);
    await expect(page.locator('[data-testid="payment-pending"]')).toBeVisible();
    await expect(page.locator('[data-testid="payment-status-badge"]')).toContainText('PENDING');
    await expect(page.locator('[data-testid="refresh-status-button"]')).toBeVisible();
    await expect(page.locator('[data-testid="resume-otp-button"]')).toBeVisible();

    // Refresh status button checks backend safely without creating duplicate payment
    await page.locator('[data-testid="refresh-status-button"]').click();
    await expect(page.locator('[data-testid="payment-pending"]')).toBeVisible();

    // Order in DB must still be PENDING_PAYMENT
    await verifyStoreOrderInDb(orderId, { status: 'PENDING_PAYMENT' });
  });
});
