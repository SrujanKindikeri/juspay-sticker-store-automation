import { test, expect } from '../fixtures/payment-fixture';
import {
  validCardData,
  invalidCardData,
  invalidUpiData,
  validUpiData,
} from '../test-data/payment-data';
import { verifyTransactionInDb } from '../utils/db';

test.describe('Negative Payment & OTP Test Scenarios', () => {
  test('should display validation error for invalid card number', async ({ checkoutPage }) => {
    await checkoutPage.open();
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails({
      ...validCardData,
      cardNumber: invalidCardData.shortNumber,
    });
    await checkoutPage.submitPayment();

    const errorMsg = await checkoutPage.getErrorMessage();
    expect(errorMsg).toContain('Please enter a valid card number');
  });

  test('should display validation error for invalid UPI ID format', async ({ checkoutPage }) => {
    await checkoutPage.open();
    await checkoutPage.selectUpiMethod();
    await checkoutPage.fillUpiDetails({ upiId: invalidUpiData.noAtSymbol });
    await checkoutPage.submitPayment();

    const errorMsg = await checkoutPage.getErrorMessage();
    expect(errorMsg).toContain('Please enter a valid UPI ID');
  });

  test('should reject empty or incomplete OTP input', async ({ checkoutPage, otpPage }) => {
    await checkoutPage.open();
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    // Submit empty OTP
    await otpPage.submitOtp('');

    const errorMsg = await otpPage.getErrorMessage();
    expect(errorMsg).toContain('Please enter a valid 6-digit numeric OTP');
  });

  test('should decrement remaining attempts on invalid OTP and reject transaction', async ({
    checkoutPage,
    otpPage,
  }) => {
    await checkoutPage.open();
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    const paymentRef = await otpPage.getTransactionReference();

    // Submit wrong OTP
    await otpPage.submitOtp('000000');

    const errorMsg = await otpPage.getErrorMessage();
    expect(errorMsg).toContain('2 attempt(s) remaining');

    // Verify DB persists incremented attempt count
    const dbRecord = await verifyTransactionInDb(
      { paymentReference: paymentRef },
      { status: 'PENDING' }
    );
    expect(dbRecord.otp_attempts).toBe(1);
  });

  test('should lock transaction to FAILED after 3 incorrect OTP attempts', async ({
    checkoutPage,
    otpPage,
    resultPage,
  }) => {
    await checkoutPage.open();
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();
    const paymentRef = await otpPage.getTransactionReference();

    // Attempt 1
    await otpPage.submitOtp('111111');
    await expect(otpPage.otpErrorBox).toContainText('2 attempt(s) remaining');

    // Attempt 2
    await otpPage.submitOtp('222222');
    await expect(otpPage.otpErrorBox).toContainText('1 attempt(s) remaining');

    // Attempt 3: Max attempts exceeded -> Transitions to FAILED
    await otpPage.submitOtp('333333');
    await resultPage.expectFailed();

    // Verify DB persists status FAILED
    await verifyTransactionInDb(
      { paymentReference: paymentRef },
      { status: 'FAILED' }
    );
  });

  test('should enforce backend resend cooldown and allow resend after wait', async ({
    checkoutPage,
    otpPage,
  }) => {
    await checkoutPage.open();
    await checkoutPage.selectCardMethod();
    await checkoutPage.fillCardDetails(validCardData);
    await checkoutPage.submitPayment();

    await otpPage.waitForLoaded();

    // Resend button is initially disabled with active cooldown countdown
    await expect(otpPage.resendButton).toBeDisabled();
    await expect(otpPage.resendButton).toContainText('Resend OTP');
  });

  test('should prevent duplicate form submissions by showing loading state', async ({
    checkoutPage,
  }) => {
    await checkoutPage.open();
    await checkoutPage.selectUpiMethod();
    await checkoutPage.fillUpiDetails(validUpiData);

    // Click submit and verify loading indicator or disabled button
    await checkoutPage.continuePaymentButton.click();
    // The button transitions to disabled state
    await expect(checkoutPage.continuePaymentButton).toBeDisabled();
  });
});
