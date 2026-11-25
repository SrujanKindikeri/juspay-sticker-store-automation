import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export class ResultPage extends BasePage {
  readonly successCard: Locator;
  readonly failedCard: Locator;
  readonly declinedCard: Locator;

  readonly statusBadge: Locator;
  readonly orderStatusBadge: Locator;
  readonly transactionReference: Locator;
  readonly transactionId: Locator;
  readonly orderId: Locator;
  readonly amountPaid: Locator;
  readonly paymentMethod: Locator;
  readonly finalizedAt: Locator;
  readonly failureReason: Locator;
  readonly startNewPaymentButton: Locator;
  readonly retryPaymentButton: Locator;

  constructor(page: Page) {
    super(page);
    this.successCard = page.locator('[data-testid="payment-success"]');
    this.failedCard = page.locator('[data-testid="payment-failed"]');
    this.declinedCard = page.locator('[data-testid="payment-declined"]');

    this.statusBadge = page.locator('[data-testid="payment-status-badge"]');
    this.orderStatusBadge = page.locator('[data-testid="order-status-badge"]');
    this.transactionReference = page.locator('[data-testid="transaction-reference"]');
    this.transactionId = page.locator('[data-testid="transaction-id"]');
    this.orderId = page.locator('[data-testid="order-id"]');
    this.amountPaid = page.locator('[data-testid="amount-paid"]');
    this.paymentMethod = page.locator('[data-testid="payment-method"]');
    this.finalizedAt = page.locator('[data-testid="finalized-at"]');
    this.failureReason = page.locator('[data-testid="failure-reason"]');
    this.startNewPaymentButton = page.locator('[data-testid="start-new-payment-button"]');
    this.retryPaymentButton = page.locator('[data-testid="retry-payment-button"]');
  }

  async expectSuccess(timeout: number = 10_000): Promise<{ reference: string; transactionId: string }> {
    await expect(this.successCard).toBeVisible({ timeout });
    await expect(this.statusBadge).toContainText('SUCCESS');

    const reference = ((await this.transactionReference.textContent()) || '').trim();
    const txId = ((await this.transactionId.textContent()) || '').trim();
    return { reference, transactionId: txId };
  }

  async expectFailed(timeout: number = 10_000): Promise<void> {
    await expect(this.failedCard).toBeVisible({ timeout });
    await expect(this.statusBadge).toContainText('FAILED');
  }

  async expectDeclined(timeout: number = 10_000): Promise<{ reference: string; transactionId: string }> {
    await expect(this.declinedCard).toBeVisible({ timeout });
    await expect(this.statusBadge).toContainText('DECLINED');

    const reference = ((await this.transactionReference.textContent()) || '').trim();
    const txId = ((await this.transactionId.textContent()) || '').trim();
    return { reference, transactionId: txId };
  }

  async clickStartNewPayment(): Promise<void> {
    await this.startNewPaymentButton.click();
  }

  async clickRetryPayment(): Promise<void> {
    await this.retryPaymentButton.click();
  }

  async getSuccessDetails(): Promise<{
    reference: string;
    transactionId: string;
    orderId: string;
    amountText: string;
    paymentMethod: string;
  }> {
    const reference = ((await this.transactionReference.textContent()) || '').trim();
    const transactionId = ((await this.transactionId.textContent()) || '').trim();
    const orderId = ((await this.orderId.textContent()) || '').trim();
    const amountText = ((await this.amountPaid.textContent()) || '').trim();
    const paymentMethod = ((await this.paymentMethod.textContent()) || '').trim();
    return { reference, transactionId, orderId, amountText, paymentMethod };
  }
}
