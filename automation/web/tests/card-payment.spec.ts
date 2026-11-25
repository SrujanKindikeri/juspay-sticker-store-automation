import { test, expect } from '../fixtures/payment-fixture';
import { validCardData, orderAmounts } from '../test-data/payment-data';
import { verifyTransactionInDb } from '../utils/db';

test.describe('Card Payment Automation Journey', () => {
  test('Complete 13-step simulated Card payment journey with database verification', async ({
    checkoutPage,
    otpPage,
    resultPage,
    page,
  }) => {
    // 1. Open JUSPAY checkout
    await checkoutPage.open();
    await checkoutPage.expectOrderAmount('₹999.00');

    // 2. Select Card
    await checkoutPage.selectCardMethod();

    // 3. Enter safe simulated test-card details
    await checkoutPage.fillCardDetails(validCardData);

    // 4. Click Continue to Payment
    // 5. Wait for transaction creation & 6. Navigate to OTP verification
    await checkoutPage.submitPayment();
    await otpPage.waitForLoaded();

    // Verify transaction details displayed on OTP screen
    const paymentRef = await otpPage.getTransactionReference();
    expect(paymentRef).toMatch(/^PAY_REF_[A-Z0-9]+$/);

    // 7. Retrieve simulated development OTP through authorized mechanism
    const simulatedOtp = await otpPage.getSimulatedOtp();
    expect(simulatedOtp).toMatch(/^\d{6}$/);

    // 8. Enter OTP automatically (using autofill or direct input)
    await otpPage.autofillOtp();
    await expect(otpPage.otpInput).toHaveValue(simulatedOtp);

    // 9. Click Verify OTP
    // 10. Verify authenticated status & 11. Trigger simulated payment processing
    // 12. Verify final SUCCESS status
    await otpPage.submitOtp();

    // 13. Verify transaction reference and confirmation
    const { reference, transactionId } = await resultPage.expectSuccess();
    expect(reference).toBe(paymentRef);
    expect(transactionId).toMatch(/^TXN_[A-Z0-9]+$/);

    // 7. Database Verification: verify PostgreSQL persistence
    const dbRecord = await verifyTransactionInDb(
      { transactionId },
      {
        status: 'SUCCESS',
        amount: orderAmounts.standard,
        paymentMethod: 'CARD',
        currency: orderAmounts.currency,
      }
    );

    expect(dbRecord.transaction_id).toBe(transactionId);
    expect(dbRecord.payment_reference).toBe(paymentRef);
    expect(dbRecord.status).toBe('SUCCESS');
    expect(dbRecord.payment_method).toBe('CARD');
    expect(Number(dbRecord.amount)).toBe(999.00);
    // Plaintext OTP is NEVER stored in database
    expect(dbRecord.otp_hash).toBeNull(); // Cleared upon successful authentication
  });
});
