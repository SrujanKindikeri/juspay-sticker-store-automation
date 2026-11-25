import { test, expect } from '../fixtures/payment-fixture';
import {
  validCardData,
  declineCardData,
  failCardData,
  orderAmounts,
} from '../test-data/payment-data';
import { verifyTransactionInDb } from '../utils/db';

test.describe('Phase 6: Payment Lifecycle and Transaction Management Automation', () => {
  const apiUrl = process.env.API_URL || 'http://localhost:8001';

  test('1. Successful payment displays complete details on result screen', async ({
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    const orderId = `ORD-P6-SUCC-${Date.now().toString().slice(-6)}`;
    await checkoutPage.open(`/?order_id=${orderId}`);
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    const paymentRef = await otpPage.getTransactionReference();
    const simulatedOtp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(simulatedOtp);

    const details = await resultPage.expectSuccess();
    expect(details.reference).toBe(paymentRef);

    // Verify all required fields on the success screen
    const fullDetails = await resultPage.getSuccessDetails();
    expect(fullDetails.reference).toBe(paymentRef);
    expect(fullDetails.orderId).toBe(orderId);
    expect(fullDetails.amountText).toContain('999.00');
    expect(fullDetails.paymentMethod).toBe('CARD');
  });

  test('2. Declined payment displays clear decline message and receipt details', async ({
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    const orderId = `ORD-P6-DECL-${Date.now().toString().slice(-6)}`;
    await checkoutPage.open(`/?order_id=${orderId}`);
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(declineCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    const simulatedOtp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(simulatedOtp);

    await resultPage.expectDeclined();
    await expect(resultPage.failureReason).toContainText('declined');
    await expect(resultPage.orderId).toHaveText(orderId);
    await expect(resultPage.paymentMethod).toHaveText('CARD');
  });

  test('3. Failed payment displays clear failure message and status badge', async ({
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    const orderId = `ORD-P6-FAIL-${Date.now().toString().slice(-6)}`;
    await checkoutPage.open(`/?order_id=${orderId}`);
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(failCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    const simulatedOtp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(simulatedOtp);

    await resultPage.expectFailed();
    await expect(resultPage.failureReason).toBeVisible();
    await expect(resultPage.statusBadge).toContainText('FAILED');
  });

  test('4. Refreshing a result page restores authoritative transaction status from backend', async ({
    page,
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    const orderId = `ORD-P6-REFRESH-${Date.now().toString().slice(-6)}`;
    await checkoutPage.open(`/?order_id=${orderId}`);
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    const simulatedOtp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(simulatedOtp);

    const initialSuccess = await resultPage.expectSuccess();
    expect(initialSuccess.transactionId).toBeTruthy();

    // Verify URL contains transaction_id
    expect(page.url()).toContain(`transaction_id=${initialSuccess.transactionId}`);

    // Refresh the page
    await page.reload();

    // The page must reload and fetch authoritative status from GET /api/v1/payments/{id}
    const restoredSuccess = await resultPage.expectSuccess();
    expect(restoredSuccess.transactionId).toBe(initialSuccess.transactionId);
    expect(restoredSuccess.reference).toBe(initialSuccess.reference);

    const fullDetails = await resultPage.getSuccessDetails();
    expect(fullDetails.orderId).toBe(orderId);
    expect(fullDetails.paymentMethod).toBe('CARD');
  });

  test('5. Preventing repeated processing on finalized transactions', async ({
    page,
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    const orderId = `ORD-P6-NOREPEAT-${Date.now().toString().slice(-6)}`;
    await checkoutPage.open(`/?order_id=${orderId}`);
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    const simulatedOtp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(simulatedOtp);

    const { transactionId } = await resultPage.expectSuccess();

    // 1. In UI, no submit or re-process button exists
    await expect(page.locator('[data-testid="pay-submit-button"]')).not.toBeVisible();
    await expect(resultPage.startNewPaymentButton).toBeVisible();

    // 2. Direct API call to re-process returns HTTP 409 Conflict
    const directProcessRes = await page.request.post(
      `${apiUrl}/api/v1/payments/${transactionId}/process`,
      { data: { outcome: 'SUCCESS' } }
    );
    expect(directProcessRes.status()).toBe(409);
    const body = await directProcessRes.json();
    expect(body.detail).toContain('already been processed');
  });

  test('6. Result screen transaction details strictly match backend GET /payments/{id} record', async ({
    page,
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    const orderId = `ORD-P6-MATCH-${Date.now().toString().slice(-6)}`;
    await checkoutPage.open(`/?order_id=${orderId}`);
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    const simulatedOtp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(simulatedOtp);

    const { transactionId, reference } = await resultPage.expectSuccess();

    // Query authoritative backend status
    const statusRes = await page.request.get(`${apiUrl}/api/v1/payments/${transactionId}`);
    expect(statusRes.status()).toBe(200);
    const backendData = await statusRes.json();

    // Compare backend fields against UI display
    expect(backendData.transaction_id).toBe(transactionId);
    expect(backendData.payment_reference).toBe(reference);
    expect(backendData.order_id).toBe(orderId);
    expect(backendData.amount).toBe(999.0);
    expect(backendData.payment_method).toBe('CARD');
    expect(backendData.status).toBe('SUCCESS');
    expect(backendData.is_finalized).toBe(true);
    expect(backendData.finalized_at).toBeTruthy();

    // Verify in PostgreSQL database
    await verifyTransactionInDb(
      { transactionId },
      {
        status: 'SUCCESS',
        amount: orderAmounts.standard,
        paymentMethod: 'CARD',
      }
    );
  });
});
