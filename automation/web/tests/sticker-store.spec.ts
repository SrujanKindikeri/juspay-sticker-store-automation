import { test, expect } from '../fixtures/payment-fixture';
import { verifyStoreOrderInDb } from '../utils/db';

test.describe('Physical Sticker Storefront and Shopping Journey', () => {
  test.beforeEach(async ({ page }) => {
    // Clear localStorage cart before each test
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('juspay_sticker_cart_v1'));
  });

  test('1. Storefront homepage loads with branding, hero, categories, and footer', async ({
    storePage,
    page,
  }) => {
    await storePage.openHome();

    // Verify brand and header using scoped testid
    const logoBrand = page.locator('[data-testid="store-logo"] .logo-brand');
    await expect(logoBrand).toBeVisible();
    await expect(logoBrand).toHaveText('Stickora');

    const logoBadge = page.locator('[data-testid="store-logo"] .logo-badge');
    await expect(logoBadge).toBeVisible();
    await expect(logoBadge).toHaveText('Premium Vinyl Stickers');

    // Verify Hero banner
    const heroTitle = page.locator('.hero-title');
    await expect(heroTitle).toBeVisible();
    await expect(heroTitle).toContainText('Stickora — Premium Vinyl Stickers');

    // Verify Category Pills
    const categoryPills = page.locator('.category-pill');
    await expect(categoryPills.first()).toBeVisible();
    const count = await categoryPills.count();
    expect(count).toBeGreaterThanOrEqual(7);

    // Verify Product grids
    await expect(page.locator('[data-testid="featured-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="best-sellers-section"]')).toBeVisible();
    await expect(page.locator('[data-testid="new-arrivals-section"]')).toBeVisible();

    // Verify Footer
    await expect(page.locator('.store-footer')).toBeVisible();
    await expect(page.locator('.store-footer')).toContainText('Stickora — Premium Vinyl Stickers');
  });

  test('2. Product catalogue browsing, category filter, and search', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();

    // Verify catalogue heading and products count
    const heading = page.locator('[data-testid="catalogue-heading"]');
    await expect(heading).toBeVisible();
    await expect(heading).toContainText('ALL STICKERS');

    const productCards = page.locator('.product-card');
    await expect(productCards.first()).toBeVisible();
    const totalCards = await productCards.count();
    expect(totalCards).toBeGreaterThanOrEqual(12);

    // Filter by Anime category
    const animePill = page.locator('[data-testid="category-pill-anime"]');
    await animePill.click();
    await page.waitForURL(/category=anime/);
    await expect(page.locator('[data-testid="catalogue-heading"]')).toContainText('ANIME STICKERS');

    // Search for a specific sticker
    await storePage.searchInput.fill('Cyberpunk');
    await storePage.searchSubmit.click();
    await page.waitForURL(/search=Cyberpunk/);
    await expect(page.locator('[data-testid="product-card-STK-001"]')).toBeVisible();
  });

  test('3. Product details page navigation and attributes', async ({
    storePage,
    page,
  }) => {
    await storePage.openProduct('STK-001');

    // Verify title and product info
    await expect(page.locator('[data-testid="product-detail-title"]')).toContainText('Cyberpunk Neon Cat');
    await expect(page.locator('[data-testid="product-detail-price"]')).toContainText('₹99');
    await expect(page.locator('[data-testid="product-detail-stock"]')).toContainText('In Stock');

    // Verify spec list
    await expect(page.locator('.detail-specs-list')).toContainText('Holographic Die-Cut Vinyl');
    await expect(page.locator('.detail-specs-list')).toContainText('3x3 inches');

    // Verify add to cart button
    await expect(page.locator('[data-testid="detail-add-to-cart-btn"]')).toBeVisible();
  });

  test('4. Complete Cart operations: adding items, quantity stepper, totals, and empty state', async ({
    storePage,
    page,
  }) => {
    // 1. Start on products catalog and add STK-001
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');

    // Verify navbar cart badge updates to 1
    await storePage.expectCartCount(1);

    // 2. Open cart page
    await storePage.openCart();
    await expect(page.locator('[data-testid="cart-item-STK-001"]')).toBeVisible();

    // Verify subtotal: ₹99.00, delivery fee: ₹50.00, total: ₹149.00
    await expect(storePage.cartSubtotal).toContainText('₹99.00');
    await expect(storePage.cartDeliveryFee).toContainText('₹50.00');
    await expect(storePage.cartTotal).toContainText('₹149.00');

    // 3. Increase quantity using stepper
    const increaseBtn = page.locator('[data-testid="increase-qty-STK-001"]');
    await increaseBtn.click();
    await expect(page.locator('[data-testid="item-qty-STK-001"]')).toHaveText('2');
    await storePage.expectCartCount(2);

    // Subtotal: 99 * 2 = 198.00, delivery: 50.00, total: 248.00
    await expect(storePage.cartSubtotal).toContainText('₹198.00');
    await expect(storePage.cartTotal).toContainText('₹248.00');

    // 4. Test remove item
    const removeBtn = page.locator('[data-testid="remove-cart-item-STK-001"]');
    await removeBtn.click();

    // Cart is now empty
    await expect(storePage.emptyCartMessage).toBeVisible();
    await expect(storePage.emptyCartMessage).toContainText('Your cart is empty');
    await expect(storePage.continueShoppingBtn).toBeVisible();
  });

  test('5. Free delivery threshold calculation in Cart', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();

    // Add STK-012 (Dev pack, ₹299)
    await storePage.addItemToCartFromCard('STK-012');
    await storePage.openCart();

    // With 1 pack (₹299), delivery fee is ₹50
    await expect(storePage.cartSubtotal).toContainText('₹299.00');
    await expect(storePage.cartDeliveryFee).toContainText('₹50.00');
    await expect(page.locator('[data-testid="free-shipping-banner"]')).toContainText('Add ₹200.00 more');

    // Increase to 2 packs: 299 * 2 = ₹598 >= ₹499 -> FREE shipping!
    await page.locator('[data-testid="increase-qty-STK-012"]').click();
    await expect(storePage.cartSubtotal).toContainText('₹598.00');
    await expect(storePage.cartDeliveryFee).toHaveText('FREE');
    await expect(storePage.cartTotal).toContainText('₹598.00');
    await expect(page.locator('[data-testid="free-shipping-banner"]')).toContainText('unlocked FREE Delivery');
  });

  test('6. Cart state persists across page refresh', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-002');
    await storePage.expectCartCount(1);

    // Refresh page
    await page.reload();
    await storePage.expectCartCount(1);

    await storePage.openCart();
    await expect(page.locator('[data-testid="cart-item-STK-002"]')).toBeVisible();
  });

  test('7. Delivery form validation on Checkout page', async ({
    storePage,
    page,
  }) => {
    // Add an item so we can access checkout
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCheckout();

    // Submit without filling form
    await storePage.submitOrder();

    // Verify validation errors appear
    await expect(storePage.checkoutError).toBeVisible();
    await expect(storePage.checkoutError).toContainText('Please correct the errors');
    await expect(page.locator('.error-text').first()).toBeVisible();
  });

  test('8. End-to-end shopping journey: Browse → Cart → Checkout → Order PENDING_PAYMENT & DB verification', async ({
    storePage,
    page,
  }) => {
    // 1. Browse and add STK-001
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.expectCartCount(1);

    // 2. Go to Cart and proceed to Checkout
    await storePage.openCart();
    await expect(storePage.cartSubtotal).toContainText('₹99.00');
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    // 3. Review order on Checkout
    await expect(storePage.checkoutSubtotal).toContainText('₹99.00');
    await expect(storePage.checkoutDeliveryFee).toContainText('₹50.00');
    await expect(storePage.checkoutTotal).toContainText('₹149.00');

    // 4. Fill valid delivery details
    await storePage.fillDeliveryDetails({
      fullName: 'Aarav Patel',
      phone: '9876543210',
      email: 'aarav.patel@example.com',
      address: '701 Skyline Towers, Outer Ring Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560103',
    });

    // 5. Submit order -> navigates directly to JUSPAY Payment Gateway
    await storePage.submitOrder();

    // 6. Verify direct navigation to JUSPAY Payment Gateway with Order ID & authoritative total
    const orderId = await storePage.waitForPaymentRedirect();
    expect(orderId).toMatch(/^STK-ORD-[A-Z0-9]+$/);
    await expect(page.locator('[data-testid="order-amount"]')).toContainText('149.00');

    // Verify Cart was cleared after order creation
    const savedCart = await page.evaluate(() => localStorage.getItem('juspay_sticker_cart_v1'));
    expect(JSON.parse(savedCart || '[]')).toHaveLength(0);

    // 7. PostgreSQL Database Verification
    const dbOrder = await verifyStoreOrderInDb(orderId, {
      status: 'PENDING_PAYMENT',
      subtotal: 99.0,
      deliveryFee: 50.0,
      totalAmount: 149.0,
    });

    expect(dbOrder.order_id).toBe(orderId);
    expect(dbOrder.status).toBe('PENDING_PAYMENT');
  });
});
