import { test, expect } from '../fixtures/payment-fixture';
import { validUpiData, orderAmounts } from '../test-data/payment-data';
import { verifyTransactionInDb } from '../utils/db';

test.describe('UPI Payment Automation Journey', () => {
  test('Complete 8-step simulated UPI payment journey with database verification', async ({
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    // Open checkout
    await checkoutPage.open();

    // 1. Select UPI
    await checkoutPage.selectUpiMethod();

    // 2. Enter a valid simulated UPI ID
    await checkoutPage.fillUpiDetails(validUpiData);

    // 3. Submit payment
    await checkoutPage.submitPayment();
    await otpPage.waitForLoaded();

    const paymentRef = await otpPage.getTransactionReference();
    expect(paymentRef).toMatch(/^PAY_REF_[A-Z0-9]+$/);

    // 4. Retrieve and enter the development test OTP
    const simulatedOtp = await otpPage.getSimulatedOtp();
    expect(simulatedOtp).toMatch(/^\d{6}$/);
    await otpPage.enterOtp(simulatedOtp);

    // 5. Verify OTP & 6. Process payment & 7. Verify SUCCESS
    await otpPage.submitOtp();

    // 8. Confirm transaction details
    const { reference, transactionId } = await resultPage.expectSuccess();
    expect(reference).toBe(paymentRef);
    expect(transactionId).toMatch(/^TXN_[A-Z0-9]+$/);

    // Database verification in PostgreSQL
    const dbRecord = await verifyTransactionInDb(
      { transactionId },
      {
        status: 'SUCCESS',
        amount: orderAmounts.standard,
        paymentMethod: 'UPI',
        currency: orderAmounts.currency,
      }
    );

    expect(dbRecord.transaction_id).toBe(transactionId);
    expect(dbRecord.payment_method).toBe('UPI');
    expect(dbRecord.status).toBe('SUCCESS');
    expect(Number(dbRecord.amount)).toBe(999.00);
  });
});
