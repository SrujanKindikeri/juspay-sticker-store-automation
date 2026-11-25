import { test, expect } from '../fixtures/payment-fixture';
import { getPool, verifyStoreOrderInDb } from '../utils/db';

const MAILPIT_API = 'http://localhost:8025/api/v1';

test.describe('Email OTP Verification & Automatic PDF Receipt E2E', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('juspay_sticker_cart_v1'));
  });

  test('1. Complete verified checkout -> Mailpit captures Email OTP, PAID order, confirmation email & PDF attachment', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    const uniqueEmail = `e2e-${Date.now()}@stickora-test.demo`;

    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    // Fill details WITHOUT verifying email first
    await storePage.fillDeliveryDetails(
      {
        fullName: 'Meera Nair',
        phone: '9876543210',
        email: uniqueEmail,
        address: '14 MG Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      false
    );

    // Attempt order placement while unverified -> blocked cleanly with helpful error
    await storePage.submitOrder();
    await expect(storePage.checkoutError).toBeVisible();
    await expect(storePage.checkoutError).toContainText(/verify your customer email/i);

    // Send email OTP -> test wrong OTP first -> then verify with real OTP from Mailpit
    await storePage.verifyEmailBtn.click();
    await expect(storePage.emailOtpInput).toBeVisible();
    await expect(storePage.resendEmailOtpBtn).toBeDisabled();

    // Incorrect email OTP shows remaining attempts
    await storePage.emailOtpInput.fill('000000');
    await storePage.confirmEmailOtpBtn.click();
    await expect(storePage.emailOtpError).toBeVisible();
    await expect(storePage.emailOtpError).toContainText(/Invalid email OTP|Maximum/i);

    // Inspect actual email captured by Mailpit & extract OTP
    const mailSearch = await page.request.get(`${MAILPIT_API}/search?query=${encodeURIComponent(uniqueEmail)}`);
    expect(mailSearch.ok()).toBeTruthy();
    const mailJson = await mailSearch.json();
    expect(mailJson.messages.length).toBeGreaterThanOrEqual(1);
    const otpMsgDetail = await (
      await page.request.get(`${MAILPIT_API}/message/${mailJson.messages[0].ID}`)
    ).json();
    const match = (otpMsgDetail.Text || '').match(/\b(\d{6})\b/);
    expect(match).toBeTruthy();

    await storePage.emailOtpInput.fill(match![1]);
    await storePage.confirmEmailOtpBtn.click();
    await expect(storePage.emailVerifiedBadge).toBeVisible();
    await expect(storePage.emailVerifiedBadge).toContainText('Email Verified');

    // Place order -> succeeds and redirects to JUSPAY Payment
    await storePage.submitOrder();
    const orderId = await storePage.waitForPaymentRedirect();

    // Complete Card Payment & Payment OTP
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'MEERA NAIR',
    });
    await checkoutPage.submitPayment();
    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();

    // Verify Success Receipt & Email Delivery Status UI
    const { transactionId } = await resultPage.expectSuccess();
    await expect(page.locator('[data-testid="receipt-email-status"]')).toContainText(
      `Confirmation email with PDF receipt sent to ${uniqueEmail}`
    );

    // Verify PDF download triggers .pdf receipt
    const downloadPromise = page.waitForEvent('download');
    await page.locator('[data-testid="download-receipt-button"]').click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`Stickora-Receipt-${orderId}.pdf`);

    // Verify PostgreSQL store_orders email_verified & receipt_email_status fields
    const dbOrder = await verifyStoreOrderInDb(orderId, { status: 'PAID' });
    expect(dbOrder.payment_transaction_id).toBe(transactionId);

    const pool = getPool();
    const emailAuditRes = await pool.query(
      'SELECT email_verified, receipt_email_status, receipt_email_sent_at, receipt_email_attempts FROM store_orders WHERE order_id = $1',
      [orderId]
    );
    expect(emailAuditRes.rows[0].email_verified).toBe(true);
    expect(emailAuditRes.rows[0].receipt_email_status).toBe('SENT');
    expect(emailAuditRes.rows[0].receipt_email_sent_at).not.toBeNull();
    expect(emailAuditRes.rows[0].receipt_email_attempts).toBe(1);

    // Verify Mailpit received Order Confirmation email with PDF attachment
    const confSearch = await page.request.get(`${MAILPIT_API}/search?query=${encodeURIComponent(orderId)}`);
    const confJson = await confSearch.json();
    expect(confJson.messages).toHaveLength(1);
    expect(confJson.messages[0].Subject).toBe('Your Juspay Sticker Store Order Confirmation');
    const confDetail = await (
      await page.request.get(`${MAILPIT_API}/message/${confJson.messages[0].ID}`)
    ).json();
    expect(confDetail.Attachments).toHaveLength(1);
    expect(confDetail.Attachments[0].FileName).toBe(`Stickora-Receipt-${orderId}.pdf`);
  });

  test('2. Editing email after verification resets verified indicator & declined payment sends no confirmation email', async ({
    storePage,
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    const email1 = `edit1-${Date.now()}@stickora-test.demo`;
    const email2 = `edit2-${Date.now()}@stickora-test.demo`;

    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCheckout();

    await storePage.fillDeliveryDetails(
      {
        fullName: 'Email Reset Tester',
        phone: '9876543210',
        email: email1,
        address: '99 Decline Street',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      true
    );

    // Change email -> Email Verified badge resets and requires re-verification
    await storePage.emailInput.fill(email2);
    await expect(storePage.emailVerifiedBadge).toHaveCount(0);
    await expect(storePage.verifyEmailBtn).toBeVisible();

    // Verify new email2 and proceed to DECLINED payment
    await storePage.verifyCheckoutEmail();
    await storePage.submitOrder();
    const orderId = await storePage.waitForPaymentRedirect();

    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      cardNumber: '4111 2222 3333 4444',
      expiry: '12/28',
      cvv: '123',
      cardHolder: 'SIMULATE DECLINE',
    });
    await checkoutPage.submitPayment();
    await otpPage.waitForOtpPage();
    await otpPage.verifyWithValidSimulatedOtp();
    await resultPage.expectDeclined();

    // Confirm no receipt confirmation email was sent for failed/declined order
    const confSearch = await page.request.get(`${MAILPIT_API}/search?query=${encodeURIComponent(orderId)}`);
    const confJson = await confSearch.json();
    expect(confJson.messages).toHaveLength(0);
  });
});
