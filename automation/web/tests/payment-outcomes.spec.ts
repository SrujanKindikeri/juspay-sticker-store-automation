import { test, expect } from '../fixtures/payment-fixture';
import {
  validCardData,
  declineCardData,
  failCardData,
  orderAmounts,
} from '../test-data/payment-data';
import { verifyTransactionInDb } from '../utils/db';

test.describe('Payment Outcome Deterministic Automation (SUCCESS, DECLINED, FAILED)', () => {
  test('Outcome Scenario 1: Deterministic SUCCESS payment journey', async ({
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    // 1. Initiate normal payment
    await checkoutPage.open();
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    // 2. OTP verification
    await otpPage.waitForLoaded();
    const paymentRef = await otpPage.getTransactionReference();
    const simulatedOtp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(simulatedOtp);

    // 3. Verify final SUCCESS outcome
    const details = await resultPage.expectSuccess();
    expect(details.reference).toBe(paymentRef);

    // 4. Verify in PostgreSQL
    await verifyTransactionInDb(
      { paymentReference: paymentRef },
      {
        status: 'SUCCESS',
        amount: orderAmounts.standard,
        paymentMethod: 'CARD',
      }
    );
  });

  test('Outcome Scenario 2: Deterministic DECLINED payment simulation', async ({
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    // 1. Initiate payment using decline simulation trigger (cardholder: 'SIMULATE DECLINE')
    await checkoutPage.open();
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(declineCardData);
    await checkoutPage.submitPayment();

    // 2. OTP verification succeeds (customer authenticated)
    await otpPage.waitForLoaded();
    const paymentRef = await otpPage.getTransactionReference();
    const simulatedOtp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(simulatedOtp);

    // 3. Verify DECLINED outcome is rendered
    const details = await resultPage.expectDeclined();
    expect(details.reference).toBe(paymentRef);

    // 4. Verify in PostgreSQL that status is DECLINED (not SUCCESS)
    await verifyTransactionInDb(
      { paymentReference: paymentRef },
      {
        status: 'DECLINED',
        amount: orderAmounts.standard,
        paymentMethod: 'CARD',
      }
    );
  });

  test('Outcome Scenario 3: Deterministic FAILED payment simulation', async ({
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    // 1. Initiate payment using fail simulation trigger (cardholder: 'SIMULATE FAIL')
    await checkoutPage.open();
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(failCardData);
    await checkoutPage.submitPayment();

    // 2. OTP verification succeeds (customer authenticated)
    await otpPage.waitForLoaded();
    const paymentRef = await otpPage.getTransactionReference();
    const simulatedOtp = await otpPage.getSimulatedOtp();
    await otpPage.submitOtp(simulatedOtp);

    // 3. Verify FAILED outcome is rendered
    await resultPage.expectFailed();

    // 4. Verify in PostgreSQL that status is FAILED (not SUCCESS)
    await verifyTransactionInDb(
      { paymentReference: paymentRef },
      {
        status: 'FAILED',
        amount: orderAmounts.standard,
        paymentMethod: 'CARD',
      }
    );
  });
});
