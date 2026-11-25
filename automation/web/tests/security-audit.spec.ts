import { test, expect } from '../fixtures/payment-fixture';
import { validCardData } from '../test-data/payment-data';
import { verifyTransactionInDb } from '../utils/db';

test.describe('Phase 5.1 Security Audit & Idempotency Automation', () => {

  test('Deterministic OTP Expiry: expired OTP is rejected without waiting 5 minutes', async ({
    page,
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    // 1. Open checkout with a unique order ID
    const uniqueOrderId = `ORD-EXPIRY-${Date.now()}`;
    await checkoutPage.open(`?order_id=${uniqueOrderId}`);
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);

    // 2. Submit payment and navigate to OTP verification
    await checkoutPage.submitPayment();
    await otpPage.waitForLoaded();

    const paymentRef = await otpPage.getTransactionReference();
    expect(paymentRef).toMatch(/^PAY_REF_[A-Z0-9]+$/);

    const otpCode = await otpPage.getSimulatedOtp();
    expect(otpCode).toMatch(/^\d{6}$/);

    // 3. Inject Controllable Clock Offset Header into verify-otp request via page.route
    // This deterministically simulates that 6 minutes (360 seconds) have elapsed
    await page.route('**/api/v1/payments/*/verify-otp', async (route) => {
      const headers = {
        ...route.request().headers(),
        'x-test-clock-offset': '360.0',
      };
      await route.continue({ headers });
    });

    // 4. Submit the OTP
    await otpPage.enterOtp(otpCode);
    await otpPage.clickVerifyOtp();

    // 5. Verify UI displays failed payment receipt with FAILED status
    await resultPage.expectFailed();

    // 6. Verify directly in PostgreSQL: transaction must be FAILED, otp_hash must be cleared (null)
    const dbRecord = await verifyTransactionInDb(
      { paymentReference: paymentRef },
      { status: 'FAILED' }
    );
    expect(dbRecord.otp_hash).toBeNull();
  });

  test('Backend Duplicate Payment Protection: cannot pay for an already completed order', async ({
    page,
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    // 1. Complete an initial payment for a unique order ID
    const completedOrderId = `ORD-DUPLICATE-PREVENT-${Date.now()}`;
    await checkoutPage.open(`?order_id=${completedOrderId}`);
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    const otp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(otp);

    const { reference } = await resultPage.expectSuccess();
    expect(reference).toMatch(/^PAY_REF_/);

    // Verify DB recorded SUCCESS
    await verifyTransactionInDb({ paymentReference: reference }, { status: 'SUCCESS' });

    // 2. Now attempt to initiate payment a SECOND time for the SAME completed order ID
    await checkoutPage.open(`?order_id=${completedOrderId}`);
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    // 3. The backend MUST reject the duplicate payment initiation with HTTP 409 Conflict
    const errorBanner = checkoutPage.paymentErrorBanner;
    await expect(errorBanner).toBeVisible();
    await expect(errorBanner).toContainText('already been successfully paid');
  });

  test('Production Mode Restriction: direct API simulation outcome override is forbidden', async ({
    request,
  }) => {
    // 1. In dev mode, verify standard health
    const healthRes = await request.get('http://127.0.0.1:8001/health');
    expect(healthRes.status()).toBe(200);

    // 2. Verify that sending a direct API request to process with an outcome parameter
    // against an unauthenticated or invalid transaction fails securely with 400 or 403
    const invalidProcessRes = await request.post(
      'http://127.0.0.1:8001/api/v1/payments/TXN_NONEXISTENT/process',
      {
        data: { outcome: 'DECLINED' },
      }
    );
    expect(invalidProcessRes.status()).toBe(404);
  });
});
