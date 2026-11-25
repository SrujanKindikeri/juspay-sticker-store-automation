import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export interface CardDetailsInput {
  cardNumber: string;
  expiry: string;
  cvv: string;
  cardHolder: string;
}

export interface UpiDetailsInput {
  upiId: string;
}

export class CheckoutPage extends BasePage {
  // Page container & header
  readonly checkoutPageContainer: Locator;
  readonly secureIndicator: Locator;
  readonly backendHealthIndicator: Locator;

  // Order Summary locators
  readonly orderSummary: Locator;
  readonly orderAmount: Locator;
  readonly orderId: Locator;

  // Method selector buttons
  readonly cardMethodTab: Locator;
  readonly upiMethodTab: Locator;
  readonly netbankingMethodTab: Locator;

  // Card form inputs
  readonly cardNumberInput: Locator;
  readonly cardExpiryInput: Locator;
  readonly cardCvvInput: Locator;
  readonly cardHolderInput: Locator;

  // UPI form inputs
  readonly upiIdInput: Locator;

  // Net Banking select
  readonly bankSelect: Locator;

  // Submit action & error banner
  readonly continuePaymentButton: Locator;
  readonly paymentLoadingIndicator: Locator;
  readonly paymentErrorBanner: Locator;

  constructor(page: Page) {
    super(page);
    this.checkoutPageContainer = page.locator('[data-testid="checkout-page"]');
    this.secureIndicator = page.locator('[data-testid="secure-payment-indicator"]');
    this.backendHealthIndicator = page.locator('[data-testid="backend-health-indicator"], [data-testid="health-badge"]');

    this.orderSummary = page.locator('[data-testid="order-summary"]');
    this.orderAmount = page.locator('[data-testid="order-amount"]');
    this.orderId = page.locator('[data-testid="order-id"], [data-testid="order-id-value"]');

    this.cardMethodTab = page.locator('[data-testid="card-method"], [data-testid="payment-method-card"]');
    this.upiMethodTab = page.locator('[data-testid="upi-method"], [data-testid="payment-method-upi"]');
    this.netbankingMethodTab = page.locator('[data-testid="netbanking-method"], [data-testid="payment-method-netbanking"]');

    this.cardNumberInput = page.locator('[data-testid="input-card-number"]');
    this.cardExpiryInput = page.locator('[data-testid="input-card-expiry"]');
    this.cardCvvInput = page.locator('[data-testid="input-card-cvv"]');
    this.cardHolderInput = page.locator('[data-testid="input-card-holder"]');

    this.upiIdInput = page.locator('[data-testid="input-upi-vpa"], [data-testid="input-upi-id"]');
    this.bankSelect = page.locator('[data-testid="select-bank-dropdown"], [data-testid="select-bank"]');

    this.continuePaymentButton = page.locator('[data-testid="continue-payment-button"]');
    this.paymentLoadingIndicator = page.locator('[data-testid="payment-loading-indicator"]');
    this.paymentErrorBanner = page.locator('[data-testid="payment-error"], .payment-error-box');
  }

  async open(queryParams: string = ''): Promise<void> {
    let targetUrl = '/payment';
    if (queryParams) {
      if (queryParams.startsWith('/payment')) {
        targetUrl = queryParams;
      } else if (queryParams.startsWith('/?')) {
        targetUrl = `/payment${queryParams.slice(1)}`;
      } else if (queryParams.startsWith('?')) {
        targetUrl = `/payment${queryParams}`;
      } else if (queryParams.startsWith('/')) {
        targetUrl = queryParams;
      } else {
        targetUrl = `/payment?${queryParams}`;
      }
    } else {
      targetUrl = `/payment?order_id=DEMO-ORD-${Date.now().toString().slice(-6)}`;
    }
    await this.navigateTo(targetUrl);
    await expect(this.checkoutPageContainer).toBeVisible();
  }

  async selectCardMethod(): Promise<void> {
    await this.cardMethodTab.click();
    await expect(this.cardNumberInput).toBeVisible();
  }

  async selectUpiMethod(): Promise<void> {
    await this.upiMethodTab.click();
    await expect(this.upiIdInput).toBeVisible();
  }

  async selectNetBankingMethod(): Promise<void> {
    await this.netbankingMethodTab.click();
    await expect(this.bankSelect).toBeVisible();
  }

  async fillCardDetails(details: CardDetailsInput): Promise<void> {
    await this.cardNumberInput.fill(details.cardNumber);
    await this.cardExpiryInput.fill(details.expiry);
    await this.cardCvvInput.fill(details.cvv);
    await this.cardHolderInput.fill(details.cardHolder);
  }

  async fillUpiDetails(details: UpiDetailsInput): Promise<void> {
    await this.upiIdInput.fill(details.upiId);
  }

  async selectBank(bankCode: string): Promise<void> {
    await this.bankSelect.selectOption(bankCode);
  }

  async submitPayment(): Promise<void> {
    await this.continuePaymentButton.click();
  }

  async getErrorMessage(): Promise<string> {
    await expect(this.paymentErrorBanner).toBeVisible();
    return (await this.paymentErrorBanner.textContent()) || '';
  }

  async expectOrderAmount(expectedAmountText: string): Promise<void> {
    await expect(this.orderAmount).toContainText(expectedAmountText);
  }
}
