import { test, expect } from '../fixtures/payment-fixture';
import * as path from 'path';
import * as fs from 'fs';

const SCREENSHOTS_DIR = path.resolve(__dirname, '../screenshots');

test.describe('Cart UI Redesign — Visual & Functional Verification', () => {
  test.beforeAll(async () => {
    if (!fs.existsSync(SCREENSHOTS_DIR)) {
      fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
    }
  });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('juspay_sticker_cart_v1'));
  });

  test('1. Desktop Two-Column Layout & Product Card Elements with Screenshot', async ({
    storePage,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });

    // 1. Add STK-001 (Cyberpunk Cat, ₹99) and STK-002 (Kitsune Mask, ₹129)
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.addItemToCartFromCard('STK-002');
    await storePage.expectCartCount(2);

    // 2. Open cart page
    await storePage.openCart();

    // 3. Verify desktop two-column grid
    const cartGrid = page.locator('.cart-grid');
    await expect(cartGrid).toBeVisible();

    const itemsCol = page.locator('.cart-items-column');
    await expect(itemsCol).toBeVisible();

    const summaryCol = page.locator('.cart-summary-column');
    await expect(summaryCol).toBeVisible();

    // 4. Verify Free Shipping Card
    const shippingBanner = page.locator('[data-testid="free-shipping-banner"]');
    await expect(shippingBanner).toBeVisible();
    await expect(shippingBanner).toContainText('Add');
    await expect(shippingBanner).toContainText('FREE Delivery');

    // 5. Verify product card details for STK-001
    const itemCard1 = page.locator('[data-testid="cart-item-STK-001"]');
    await expect(itemCard1).toBeVisible();
    await expect(itemCard1.locator('.product-name-link')).toContainText('Cyberpunk Neon Cat');
    await expect(itemCard1.locator('.product-spec-line')).toContainText('3x3 inches');
    await expect(itemCard1.locator('.unit-price-val')).toContainText('₹99.00');

    // Minus button disabled on qty = 1
    const decBtn = page.locator('[data-testid="decrease-qty-STK-001"]');
    await expect(decBtn).toBeDisabled();

    // Stepper display is 1
    const qtyVal = page.locator('[data-testid="item-qty-STK-001"]');
    await expect(qtyVal).toHaveText('1');

    // Item total is ₹99.00
    await expect(itemCard1.locator('.item-total-amount')).toContainText('₹99.00');

    // Remove button is visible
    const removeBtn = page.locator('[data-testid="remove-cart-item-STK-001"]');
    await expect(removeBtn).toBeVisible();

    // 6. Verify sticky Order Summary
    const summaryCard = page.locator('.cart-summary-sticky-card');
    await expect(summaryCard).toBeVisible();
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText('₹188.00');
    await expect(page.locator('[data-testid="cart-delivery-fee"]')).toContainText('₹50.00');
    await expect(page.locator('[data-testid="cart-total"]')).toContainText('₹238.00');
    await expect(page.locator('[data-testid="proceed-to-checkout-btn"]')).toBeVisible();

    // 7. Capture desktop screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'cart-desktop.png'),
      fullPage: true,
    });
  });

  test('2. Mobile Responsive Layout without Overflow with Screenshot', async ({
    storePage,
    page,
  }) => {
    // Set iPhone 13 / mobile viewport
    await page.setViewportSize({ width: 375, height: 750 });

    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.addItemToCartFromCard('STK-003');
    await storePage.openCart();

    // Verify product card and summary are visible in single column
    await expect(page.locator('[data-testid="cart-item-STK-001"]')).toBeVisible();
    await expect(page.locator('[data-testid="cart-item-STK-003"]')).toBeVisible();
    await expect(page.locator('.cart-summary-sticky-card')).toBeVisible();

    // Verify NO horizontal scrolling
    const hasHorizontalOverflow = await page.evaluate(() => {
      return document.documentElement.scrollWidth > document.documentElement.clientWidth;
    });
    expect(hasHorizontalOverflow).toBeFalsy();

    // Capture mobile screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'cart-mobile.png'),
      fullPage: true,
    });
  });

  test('3. Empty Cart View: Heading, Message, Illustration & Categories with Screenshot', async ({
    storePage,
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await storePage.openCart();

    // Verify empty cart container
    const emptyContainer = page.locator('[data-testid="empty-cart-container"]');
    await expect(emptyContainer).toBeVisible();

    // Verify requested heading: "Your cart is waiting for something awesome!"
    const heading = page.locator('.empty-cart-title');
    await expect(heading).toBeVisible();
    await expect(heading).toHaveText('Your cart is waiting for something awesome!');

    // Verify message contains "Your cart is empty"
    const message = page.locator('[data-testid="empty-cart-message"]');
    await expect(message).toBeVisible();
    await expect(message).toContainText('Your cart is empty');

    // Verify SVG illustration
    await expect(page.locator('.empty-cart-svg')).toBeVisible();

    // Verify Continue Shopping button links to /products
    const continueBtn = page.locator('[data-testid="continue-shopping-btn"]');
    await expect(continueBtn).toBeVisible();
    await expect(continueBtn).toHaveAttribute('href', '/products');

    // Verify category exploration pills
    await expect(page.locator('.empty-cart-categories')).toBeVisible();
    await expect(page.locator('.empty-cat-pill').first()).toBeVisible();

    // Capture empty cart desktop screenshot
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'cart-empty-desktop.png'),
      fullPage: false,
    });

    // Also capture on mobile
    await page.setViewportSize({ width: 375, height: 667 });
    await page.screenshot({
      path: path.join(SCREENSHOTS_DIR, 'cart-empty-mobile.png'),
      fullPage: false,
    });
  });

  test('4. Quantity Stepper: Prevent below 1, increase, immediate subtotal updates', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCart();

    // On mount, qty is 1, minus button is disabled
    const decBtn = page.locator('[data-testid="decrease-qty-STK-001"]');
    const incBtn = page.locator('[data-testid="increase-qty-STK-001"]');
    const qtyDisplay = page.locator('[data-testid="item-qty-STK-001"]');

    await expect(qtyDisplay).toHaveText('1');
    await expect(decBtn).toBeDisabled();

    // Click minus (even if forced) does not reduce below 1
    await decBtn.click({ force: true });
    await expect(qtyDisplay).toHaveText('1');

    // Click plus: increases to 2
    await incBtn.click();
    await expect(qtyDisplay).toHaveText('2');
    await expect(decBtn).toBeEnabled();

    // Subtotal immediately updates to ₹198.00
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText('₹198.00');

    // Click plus again: increases to 3
    await incBtn.click();
    await expect(qtyDisplay).toHaveText('3');
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText('₹297.00');

    // Click minus: decreases back to 2
    await decBtn.click();
    await expect(qtyDisplay).toHaveText('2');
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText('₹198.00');
  });

  test('5. Remove Item: dedicated remove button clears individual product', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.addItemToCartFromCard('STK-002');
    await storePage.openCart();

    await expect(page.locator('[data-testid="cart-item-STK-001"]')).toBeVisible();
    await expect(page.locator('[data-testid="cart-item-STK-002"]')).toBeVisible();
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText('₹188.00');

    // Remove STK-001
    await page.locator('[data-testid="remove-cart-item-STK-001"]').click();

    // STK-001 is gone, STK-002 remains
    await expect(page.locator('[data-testid="cart-item-STK-001"]')).not.toBeVisible();
    await expect(page.locator('[data-testid="cart-item-STK-002"]')).toBeVisible();
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText('₹89.00');
  });

  test('6. Delivery charges dynamically update (₹50 vs FREE at threshold ₹499)', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();
    // Add Dev pack (₹299)
    await storePage.addItemToCartFromCard('STK-012');
    await storePage.openCart();

    // 1 pack: ₹299 < ₹499 -> Delivery fee is ₹50
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText('₹299.00');
    await expect(page.locator('[data-testid="cart-delivery-fee"]')).toContainText('₹50.00');
    await expect(page.locator('[data-testid="cart-total"]')).toContainText('₹349.00');
    await expect(page.locator('[data-testid="free-shipping-banner"]')).toContainText('Add ₹200.00 more');

    // Increase to 2 packs: ₹598 >= ₹499 -> FREE delivery
    await page.locator('[data-testid="increase-qty-STK-012"]').click();
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText('₹598.00');
    await expect(page.locator('[data-testid="cart-delivery-fee"]')).toHaveText('FREE');
    await expect(page.locator('[data-testid="cart-total"]')).toContainText('₹598.00');
    await expect(page.locator('[data-testid="free-shipping-banner"]')).toContainText('unlocked FREE Delivery');
  });

  test('7. Cart persistence across page refresh', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCart();

    await page.locator('[data-testid="increase-qty-STK-001"]').click();
    await expect(page.locator('[data-testid="item-qty-STK-001"]')).toHaveText('2');

    // Reload
    await page.reload();

    // Assert quantity and totals are preserved from localStorage
    await expect(page.locator('[data-testid="item-qty-STK-001"]')).toHaveText('2');
    await expect(page.locator('[data-testid="cart-subtotal"]')).toContainText('₹198.00');
  });

  test('8. Proceed to Checkout navigates seamlessly to delivery checkout', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCart();

    // Click Proceed to Checkout
    const checkoutBtn = page.locator('[data-testid="proceed-to-checkout-btn"]');
    await expect(checkoutBtn).toBeVisible();
    await checkoutBtn.click();

    // Verify navigated to /checkout
    await page.waitForURL('**/checkout');
    await expect(page.locator('[data-testid="checkout-name-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="checkout-subtotal"]')).toContainText('₹99.00');
    await expect(page.locator('[data-testid="checkout-total"]')).toContainText('₹149.00');
  });
});
