import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './BasePage';

export interface DeliveryDetails {
  fullName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
}

export class StorePage extends BasePage {
  // Navigation elements
  readonly navCartLink: Locator;
  readonly navCartCount: Locator;
  readonly searchInput: Locator;
  readonly searchSubmit: Locator;

  // Cart elements
  readonly cartSubtotal: Locator;
  readonly cartDeliveryFee: Locator;
  readonly cartTotal: Locator;
  readonly proceedToCheckoutBtn: Locator;
  readonly clearCartBtn: Locator;
  readonly emptyCartMessage: Locator;
  readonly continueShoppingBtn: Locator;

  // Checkout form elements
  readonly nameInput: Locator;
  readonly phoneInput: Locator;
  readonly emailInput: Locator;
  readonly addressInput: Locator;
  readonly cityInput: Locator;
  readonly stateInput: Locator;
  readonly pincodeInput: Locator;
  readonly verifyEmailBtn: Locator;
  readonly emailOtpInput: Locator;
  readonly emailOtpAutofillBtn: Locator;
  readonly confirmEmailOtpBtn: Locator;
  readonly resendEmailOtpBtn: Locator;
  readonly emailVerifiedBadge: Locator;
  readonly emailOtpError: Locator;
  readonly placeOrderBtn: Locator;
  readonly checkoutError: Locator;

  // Order review on checkout
  readonly checkoutSubtotal: Locator;
  readonly checkoutDeliveryFee: Locator;
  readonly checkoutTotal: Locator;

  // Order confirmation elements
  readonly confirmationScreen: Locator;
  readonly orderIdConfirmation: Locator;
  readonly orderStatusBadge: Locator;
  readonly orderTotalAmount: Locator;
  readonly orderDeliveryRecap: Locator;
  readonly proceedToPaymentGatewayBtn: Locator;

  constructor(page: Page) {
    super(page);

    this.navCartLink = page.locator('[data-testid="nav-cart-button"]');
    this.navCartCount = page.locator('[data-testid="cart-count-badge"]');
    this.searchInput = page.locator('[data-testid="store-search-input"]');
    this.searchSubmit = page.locator('[data-testid="store-search-button"]');

    this.cartSubtotal = page.locator('[data-testid="cart-subtotal"]');
    this.cartDeliveryFee = page.locator('[data-testid="cart-delivery-fee"]');
    this.cartTotal = page.locator('[data-testid="cart-total"]');
    this.proceedToCheckoutBtn = page.locator('[data-testid="proceed-to-checkout-btn"]');
    this.clearCartBtn = page.locator('[data-testid="clear-cart-btn"]');
    this.emptyCartMessage = page.locator('[data-testid="empty-cart-message"]');
    this.continueShoppingBtn = page.locator('[data-testid="continue-shopping-btn"]');

    this.nameInput = page.locator('[data-testid="checkout-name-input"]');
    this.phoneInput = page.locator('[data-testid="checkout-phone-input"]');
    this.emailInput = page.locator('[data-testid="checkout-email-input"]');
    this.addressInput = page.locator('[data-testid="checkout-address-input"]');
    this.cityInput = page.locator('[data-testid="checkout-city-input"]');
    this.stateInput = page.locator('[data-testid="checkout-state-input"]');
    this.pincodeInput = page.locator('[data-testid="checkout-pincode-input"]');
    this.verifyEmailBtn = page.locator('[data-testid="verify-email-button"]');
    this.emailOtpInput = page.locator('[data-testid="email-otp-input"]');
    this.emailOtpAutofillBtn = page.locator('[data-testid="email-otp-autofill-btn"]');
    this.confirmEmailOtpBtn = page.locator('[data-testid="confirm-email-otp-button"]');
    this.resendEmailOtpBtn = page.locator('[data-testid="resend-email-otp-button"]');
    this.emailVerifiedBadge = page.locator('[data-testid="email-verified-badge"]');
    this.emailOtpError = page.locator('[data-testid="email-otp-error"]');
    this.placeOrderBtn = page.locator('[data-testid="place-order-button"]');
    this.checkoutError = page.locator('[data-testid="checkout-error"]');

    this.checkoutSubtotal = page.locator('[data-testid="checkout-subtotal"]');
    this.checkoutDeliveryFee = page.locator('[data-testid="checkout-delivery-fee"]');
    this.checkoutTotal = page.locator('[data-testid="checkout-total"]');

    this.confirmationScreen = page.locator('[data-testid="order-confirmation-screen"]');
    this.orderIdConfirmation = page.locator('[data-testid="order-id-confirmation"]');
    this.orderStatusBadge = page.locator('[data-testid="order-status-badge"]');
    this.orderTotalAmount = page.locator('[data-testid="order-total-amount"]');
    this.orderDeliveryRecap = page.locator('[data-testid="order-delivery-recap"]');
    this.proceedToPaymentGatewayBtn = page.locator('[data-testid="proceed-to-payment-gateway-btn"]');
  }

  async openHome(): Promise<void> {
    await this.navigateTo('/');
    await this.page.waitForSelector('[data-testid="hero-banner"]', { state: 'visible' });
  }

  async openCatalog(category?: string): Promise<void> {
    const url = category ? `/products?category=${encodeURIComponent(category)}` : '/products';
    await this.navigateTo(url);
    await this.page.waitForSelector('[data-testid="products-catalogue-page"]', { state: 'visible' });
  }

  async openProduct(productId: string): Promise<void> {
    await this.navigateTo(`/products/${productId}`);
    await this.page.waitForSelector('[data-testid="product-detail-page"]', { state: 'visible' });
  }

  async openCart(): Promise<void> {
    if (await this.navCartLink.isVisible()) {
      await this.navCartLink.click();
    } else {
      await this.navigateTo('/cart');
    }
    await this.page.waitForURL('**/cart');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async openCheckout(): Promise<void> {
    await this.navigateTo('/checkout');
    await this.page.waitForLoadState('domcontentloaded');
  }

  async addItemToCartFromCard(productId: string): Promise<void> {
    const addBtn = this.page.locator(`[data-testid="add-to-cart-btn-${productId}"]`);
    await addBtn.click();
  }

  async addItemToCartFromDetail(): Promise<void> {
    const addBtn = this.page.locator('[data-testid="detail-add-to-cart-btn"]');
    await addBtn.click();
  }

  async expectCartCount(count: number): Promise<void> {
    await expect(this.navCartCount).toBeVisible();
    await expect(this.navCartCount).toHaveText(String(count));
  }

  async verifyCheckoutEmail(): Promise<void> {
    await this.verifyEmailBtn.click();
    await expect(this.emailOtpInput).toBeVisible({ timeout: 10_000 });
    await expect(this.emailOtpAutofillBtn).toBeVisible({ timeout: 5_000 });
    await this.emailOtpAutofillBtn.click();
    await this.confirmEmailOtpBtn.click();
    await expect(this.emailVerifiedBadge).toBeVisible({ timeout: 10_000 });
    await expect(this.emailVerifiedBadge).toContainText('Email Verified');
  }

  async fillDeliveryDetails(details: DeliveryDetails, verifyEmail: boolean = true): Promise<void> {
    await this.nameInput.fill(details.fullName);
    await this.phoneInput.fill(details.phone);
    await this.emailInput.fill(details.email);
    await this.addressInput.fill(details.address);
    await this.cityInput.fill(details.city);
    await this.stateInput.fill(details.state);
    await this.pincodeInput.fill(details.pincode);
    if (verifyEmail) {
      await this.verifyCheckoutEmail();
    }
  }

  async submitOrder(): Promise<void> {
    await this.placeOrderBtn.click();
  }

  async waitForPaymentRedirect(): Promise<string> {
    await this.page.waitForURL(/.*\/payment\?order_id=STK-ORD-.*/, { timeout: 15_000 });
    const url = new URL(this.page.url());
    return url.searchParams.get('order_id') || '';
  }

  async expectOrderConfirmation(): Promise<{
    orderId: string;
    status: string;
    total: string;
  }> {
    const orderId = await this.waitForPaymentRedirect();
    const orderAmountEl = this.page.locator('[data-testid="order-amount"]');
    await expect(orderAmountEl).toBeVisible({ timeout: 10_000 });
    const total = (await orderAmountEl.textContent())?.trim() || '';

    return { orderId, status: 'PENDING_PAYMENT', total };
  }

  async proceedToPaymentGateway(): Promise<void> {
    await this.page.waitForURL(/.*\/payment\?order_id=.*/, { timeout: 10_000 });
  }
}
