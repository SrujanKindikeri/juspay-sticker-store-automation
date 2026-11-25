import { test, expect } from '../fixtures/payment-fixture';
import { supportedBanks, orderAmounts } from '../test-data/payment-data';
import { verifyTransactionInDb } from '../utils/db';

test.describe('Net Banking Payment Flow Automation', () => {
  test('should complete end-to-end Net Banking journey with demo bank selection and PostgreSQL audit', async ({
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    // 1. Open JUSPAY checkout
    await checkoutPage.open();

    // 2. Select Net Banking method
    await checkoutPage.selectNetBankingMethod();

    // 3. Select a supported demo bank
    const selectedBank = supportedBanks[0].code; // HDFC
    await checkoutPage.selectBank(selectedBank);

    // 4. Submit payment & wait for OTP page
    await checkoutPage.submitPayment();
    await otpPage.waitForLoaded();

    const paymentRef = await otpPage.getTransactionReference();
    expect(paymentRef).toMatch(/^PAY_REF_[A-Z0-9]+$/);

    // 5. Retrieve development simulated OTP
    const simulatedOtp = await otpPage.getSimulatedOtp();
    expect(simulatedOtp).toMatch(/^\d{6}$/);

    // 6. Enter OTP and submit
    await otpPage.submitOtp(simulatedOtp);

    // 7. Verify SUCCESS on result screen
    const resultDetails = await resultPage.expectSuccess();
    expect(resultDetails.reference).toBe(paymentRef);

    // 8. Confirm transaction details in PostgreSQL
    await verifyTransactionInDb(
      { paymentReference: paymentRef },
      {
        status: 'SUCCESS',
        amount: orderAmounts.standard,
        paymentMethod: 'NET_BANKING',
        currency: orderAmounts.currency,
      }
    );
  });
});
