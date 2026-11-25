import { test, expect } from '../fixtures/payment-fixture';
import { getPool, queryProductStock, verifyStoreOrderInDb } from '../utils/db';

test.describe('Urgent Fix Verification — Place Order (Pending Payment) Button', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('juspay_sticker_cart_v1'));
  });

  test('1. Valid checkout -> loading state, single order in PostgreSQL (PENDING_PAYMENT), items saved & immediate JUSPAY payment navigation', async ({
    storePage,
    checkoutPage,
    page,
  }) => {
    const initialStock = await queryProductStock('STK-001');
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleErrors.push(msg.text());
      }
    });

    // 1. Add sticker to cart & open checkout
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.expectCartCount(1);
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    // 2. Fill valid delivery details
    await storePage.fillDeliveryDetails({
      fullName: 'Rohan Kulkarni',
      phone: '9876543210',
      email: 'rohan.kulkarni@example.com',
      address: '42 Indiranagar 100 Feet Road',
      city: 'Bengaluru',
      state: 'Karnataka',
      pincode: '560038',
    });

    // 3. Delay backend response slightly to deterministically assert button loading & disabled state
    let apiStatus = 0;
    let apiResponseBody: any = null;
    await page.route('**/api/v1/store/orders', async (route) => {
      await new Promise((r) => setTimeout(r, 350));
      const response = await route.fetch();
      apiStatus = response.status();
      apiResponseBody = await response.json();
      await route.fulfill({ response });
    });

    // 4. Click "Place Order (Pending Payment)"
    await storePage.placeOrderBtn.click();

    // Verify loading behavior while request is in flight
    await expect(storePage.placeOrderBtn).toBeDisabled();
    await expect(storePage.placeOrderBtn).toContainText(/Placing Order|Redirecting/);

    // 5. Verify immediate navigation to JUSPAY payment initiation flow with order_id
    const orderId = await storePage.waitForPaymentRedirect();
    expect(orderId).toMatch(/^STK-ORD-[A-Z0-9]+$/);
    expect(apiStatus).toBe(201);
    expect(apiResponseBody.order_id).toBe(orderId);
    expect(apiResponseBody.status).toBe('PENDING_PAYMENT');
    expect(apiResponseBody.total_amount).toBe(149);

    // 6. Verify authoritative total on JUSPAY payment page
    await expect(checkoutPage.orderAmount).toContainText('149.00');

    // 7. Verify zero browser console errors
    expect(consoleErrors).toHaveLength(0);

    // 8. Verify PostgreSQL persistence: store_orders, store_order_items, store_customer_deliveries, and stock
    const dbOrder = await verifyStoreOrderInDb(orderId, {
      status: 'PENDING_PAYMENT',
      subtotal: 99.0,
      deliveryFee: 50.0,
      totalAmount: 149.0,
    });
    expect(dbOrder.stock_reserved).toBe(true);

    const pool = getPool();
    const itemsRes = await pool.query(
      'SELECT product_id, product_name, unit_price, quantity, total_price FROM store_order_items WHERE order_id = $1',
      [orderId]
    );
    expect(itemsRes.rows).toHaveLength(1);
    expect(itemsRes.rows[0].product_id).toBe('STK-001');
    expect(itemsRes.rows[0].quantity).toBe(1);
    expect(Number(itemsRes.rows[0].total_price)).toBe(99);

    const deliveryRes = await pool.query(
      'SELECT full_name, mobile_number, email, city, pincode FROM store_customer_deliveries WHERE order_id = $1',
      [orderId]
    );
    expect(deliveryRes.rows).toHaveLength(1);
    expect(deliveryRes.rows[0].full_name).toBe('Rohan Kulkarni');
    expect(deliveryRes.rows[0].pincode).toBe('560038');

    const stockAfter = await queryProductStock('STK-001');
    expect(stockAfter).toBe(initialStock - 1);
  });

  test('2. Missing delivery information shows validation errors and prevents API submission', async ({
    storePage,
    page,
  }) => {
    let apiCalls = 0;
    await page.route('**/api/v1/store/orders', async (route) => {
      apiCalls += 1;
      await route.continue();
    });

    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCheckout();

    // Fill only name, leave rest missing
    await storePage.nameInput.fill('Incomplete User');
    await storePage.placeOrderBtn.click();

    await expect(storePage.checkoutError).toBeVisible();
    await expect(storePage.checkoutError).toContainText('Please correct the errors');
    await expect(page.locator('.error-text').first()).toBeVisible();
    await expect(storePage.placeOrderBtn).toBeEnabled();
    expect(apiCalls).toBe(0);
  });

  test('3. Empty cart shows empty cart state and prevents checkout order submission', async ({
    storePage,
    page,
  }) => {
    await storePage.openCheckout();

    await expect(page.locator('[data-testid="empty-cart-container"]')).toBeVisible();
    await expect(storePage.emptyCartMessage).toContainText('Your cart is empty');
    await expect(storePage.placeOrderBtn).toHaveCount(0);
  });

  test('4. Out-of-stock product displays useful backend error and preserves cart', async ({
    storePage,
    page,
  }) => {
    const pool = getPool();
    const originalStock = await queryProductStock('STK-002');

    try {
      await storePage.openCatalog();
      await storePage.addItemToCartFromCard('STK-002');
      await storePage.openCheckout();

      // Simulate product going out of stock right before customer submits
      await pool.query("UPDATE store_products SET stock_quantity = 0 WHERE id = 'STK-002'");

      await storePage.fillDeliveryDetails({
        fullName: 'Stock Tester',
        phone: '9876543210',
        email: 'stock.tester@example.com',
        address: '10 Stock Lane',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      });

      await storePage.placeOrderBtn.click();

      await expect(storePage.checkoutError).toBeVisible();
      await expect(storePage.checkoutError).toContainText(/Insufficient stock/i);
      await expect(page).toHaveURL(/.*\/checkout/);
      await expect(storePage.placeOrderBtn).toBeEnabled();
      await storePage.expectCartCount(1);
    } finally {
      await pool.query('UPDATE store_products SET stock_quantity = $1 WHERE id = $2', [
        originalStock,
        'STK-002',
      ]);
    }
  });

  test('5. Backend unavailable displays friendly connection error and allows retry', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCheckout();

    await storePage.fillDeliveryDetails({
      fullName: 'Offline Tester',
      phone: '9876543210',
      email: 'offline@example.com',
      address: '99 Network Down St',
      city: 'Pune',
      state: 'Maharashtra',
      pincode: '411001',
    });

    await page.route('**/api/v1/store/orders', async (route) => {
      await route.abort('connectionrefused');
    });

    await storePage.placeOrderBtn.click();

    await expect(storePage.checkoutError).toBeVisible();
    await expect(storePage.checkoutError).toContainText(/Unable to reach the order service/i);
    await expect(storePage.placeOrderBtn).toBeEnabled();
    await storePage.expectCartCount(1);
  });

  test('6. Double-clicking Place Order button prevents duplicate submissions and creates exactly one order', async ({
    storePage,
    page,
  }) => {
    let requestCount = 0;
    const createdOrderIds: string[] = [];

    await page.route('**/api/v1/store/orders', async (route) => {
      requestCount += 1;
      await new Promise((r) => setTimeout(r, 400));
      const response = await route.fetch();
      const body = await response.json();
      if (body?.order_id) {
        createdOrderIds.push(body.order_id);
      }
      await route.fulfill({ response });
    });

    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-003');
    await storePage.openCheckout();

    await storePage.fillDeliveryDetails({
      fullName: 'Double Click Guard',
      phone: '9876543210',
      email: 'doubleclick@example.com',
      address: '55 Concurrency Road',
      city: 'Hyderabad',
      state: 'Telangana',
      pincode: '500081',
    });

    // Rapid double-click on the submit button
    await storePage.placeOrderBtn.dblclick();

    const orderId = await storePage.waitForPaymentRedirect();
    expect(requestCount).toBe(1);
    expect(createdOrderIds).toEqual([orderId]);

    const pool = getPool();
    const dbCheck = await pool.query('SELECT COUNT(*)::int AS cnt FROM store_orders WHERE order_id = $1', [
      orderId,
    ]);
    expect(dbCheck.rows[0].cnt).toBe(1);
  });

  test('7. Refreshing after order creation preserves authoritative order on payment page without creating duplicates', async ({
    storePage,
    checkoutPage,
    page,
  }) => {
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCheckout();

    await storePage.fillDeliveryDetails({
      fullName: 'Refresh Resilience User',
      phone: '9876543210',
      email: 'refresh.resilience@example.com',
      address: '88 Persistence Blvd',
      city: 'Chennai',
      state: 'Tamil Nadu',
      pincode: '600001',
    });

    await storePage.placeOrderBtn.click();
    const orderId = await storePage.waitForPaymentRedirect();
    await expect(checkoutPage.orderAmount).toContainText('149.00');

    // Refresh payment page after order creation
    await page.reload();
    await expect(page).toHaveURL(new RegExp(`.*\\/payment\\?order_id=${orderId}.*`));
    await expect(checkoutPage.orderAmount).toContainText('149.00');

    const dbOrder = await verifyStoreOrderInDb(orderId, {
      status: 'PENDING_PAYMENT',
      totalAmount: 149.0,
    });
    expect(dbOrder.order_id).toBe(orderId);

    // Navigating back to /checkout shows empty cart cleanly (no duplicate order)
    await storePage.openCheckout();
    await expect(storePage.emptyCartMessage).toContainText('Your cart is empty');
  });
});
