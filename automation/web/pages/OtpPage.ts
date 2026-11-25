import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class OtpPage extends BasePage {
  readonly otpPageContainer: Locator;
  readonly otpContainer: Locator;
  readonly otpHeading: Locator;
  readonly maskedContactText: Locator;
  readonly transactionReferenceText: Locator;
  readonly transactionReferenceCode: Locator;

  // Development simulated OTP helper
  readonly simulatedOtpBox: Locator;
  readonly otpCodeDisplay: Locator;
  readonly simulatedOtpDisplay: Locator;
  readonly autofillOtpButton: Locator;
  readonly autofillButton: Locator;

  // Inputs & Actions
  readonly otpInput: Locator;
  readonly verifyOtpButton: Locator;
  readonly verifyButton: Locator;
  readonly resendOtpButton: Locator;
  readonly resendButton: Locator;
  readonly backToCheckoutButton: Locator;

  // Error & Status
  readonly otpErrorBanner: Locator;
  readonly otpErrorBox: Locator;
  readonly otpInfoBanner: Locator;

  constructor(page: Page) {
    super(page);
    this.otpPageContainer = page.locator('[data-testid="otp-page"]');
    this.otpContainer = this.otpPageContainer;
    this.otpHeading = page.locator('[data-testid="otp-heading"]');
    this.maskedContactText = page.locator('.masked-contact');
    this.transactionReferenceText = page.locator('[data-testid="transaction-reference"]');
    this.transactionReferenceCode = this.transactionReferenceText;

    this.simulatedOtpBox = page.locator('[data-testid="simulated-otp-box"]');
    this.otpCodeDisplay = page.locator('.otp-code-display');
    this.simulatedOtpDisplay = this.otpCodeDisplay;
    this.autofillOtpButton = page.locator('[data-testid="autofill-otp-button"]');
    this.autofillButton = this.autofillOtpButton;

    this.otpInput = page.locator('[data-testid="otp-input"]');
    this.verifyOtpButton = page.locator('[data-testid="verify-otp-button"]');
    this.verifyButton = this.verifyOtpButton;
    this.resendOtpButton = page.locator('[data-testid="resend-otp-button"]');
    this.resendButton = this.resendOtpButton;
    this.backToCheckoutButton = page.locator('[data-testid="back-to-checkout-button"]');

    this.otpErrorBanner = page.locator('[data-testid="otp-error"]');
    this.otpErrorBox = this.otpErrorBanner;
    this.otpInfoBanner = page.locator('.otp-info-box');
  }

  async waitForLoaded(): Promise<void> {
    await expect(this.otpPageContainer).toBeVisible({ timeout: 10_000 });
  }

  async waitForOtpPage(): Promise<void> {
    await this.waitForLoaded();
  }

  async getSimulatedOtp(): Promise<string> {
    await expect(this.simulatedOtpBox).toBeVisible({ timeout: 7_000 });
    return (await this.otpCodeDisplay.textContent())?.trim() || '';
  }

  async enterOtp(otp: string): Promise<void> {
    await this.otpInput.fill(otp);
  }

  async clickAutofill(): Promise<void> {
    await expect(this.autofillOtpButton).toBeVisible();
    await this.autofillOtpButton.click();
  }

  async autofillOtp(): Promise<void> {
    await this.clickAutofill();
  }

  async clickVerifyOtp(): Promise<void> {
    await this.verifyOtpButton.click();
  }

  async submitOtp(otp?: string): Promise<void> {
    if (otp !== undefined) {
      await this.enterOtp(otp);
    }
    await this.clickVerifyOtp();
  }

  async verifyWithValidSimulatedOtp(): Promise<void> {
    const code = await this.getSimulatedOtp();
    await this.submitOtp(code);
  }

  async clickResend(): Promise<void> {
    await this.resendOtpButton.click();
  }

  async clickResendOtp(): Promise<void> {
    await this.clickResend();
  }

  async clickBackToCheckout(): Promise<void> {
    await this.backToCheckoutButton.click();
  }

  async getErrorMessage(): Promise<string> {
    await expect(this.otpErrorBanner).toBeVisible({ timeout: 5_000 });
    return (await this.otpErrorBanner.textContent()) || '';
  }

  async getTransactionReference(): Promise<string> {
    return (await this.transactionReferenceText.textContent())?.trim() || '';
  }

  async getResendButtonText(): Promise<string> {
    return (await this.resendOtpButton.textContent()) || '';
  }

  async isResendButtonDisabled(): Promise<boolean> {
    return await this.resendOtpButton.isDisabled();
  }
}
