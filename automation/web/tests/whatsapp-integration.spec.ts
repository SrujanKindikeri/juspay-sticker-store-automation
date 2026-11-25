import { test, expect } from '../fixtures/payment-fixture';

test.describe('Stickora Experimental WhatsApp Integration UI', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.evaluate(() => localStorage.removeItem('juspay_sticker_cart_v1'));
  });

  test('1. Merchant WhatsApp admin console requires authentication and hides session QR when locked', async ({
    page,
  }) => {
    await page.goto('/admin/whatsapp');
    await expect(page.getByTestId('merchant-whatsapp-admin-page')).toBeVisible();
    await expect(page.getByTestId('admin-wa-login-card')).toBeVisible();
    await expect(page.getByTestId('admin-wa-qr-image')).toHaveCount(0);

    await page.getByTestId('admin-wa-key-input').fill('invalid-admin-key-123');
    await page.getByTestId('admin-wa-login-btn').click();
    await expect(page.getByTestId('admin-wa-auth-error')).toBeVisible();
  });

  test('2. Verify WhatsApp normalizes Indian mobile 9640404455 to +919640404455, calls FastAPI, handles disconnected error cleanly, and keeps Place Order disabled until verified', async ({
    storePage,
    page,
  }) => {
    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    await expect(page.getByTestId('select-channel-email')).toHaveClass(/active/);
    await page.getByTestId('select-channel-whatsapp').click();
    await expect(page.getByTestId('select-channel-whatsapp')).toHaveClass(/active/);

    // Place Order stays disabled while WhatsApp contact is unverified
    await expect(storePage.placeOrderBtn).toBeDisabled();
    await expect(page.getByTestId('place-order-lock-note')).toBeVisible();

    // Invalid Indian number is rejected client-side without invoking backend or showing OTP input
    await storePage.phoneInput.fill('1234567890');
    await expect(page.getByTestId('verify-whatsapp-button')).toBeEnabled();
    await page.getByTestId('verify-whatsapp-button').click();
    await expect(page.getByTestId('whatsapp-otp-error')).toContainText(/10-digit Indian/i);
    await expect(page.getByTestId('whatsapp-otp-input')).toHaveCount(0);

    // Valid Indian mobile 9640404455 -> normalized to +919640404455 -> hits actual FastAPI /send-otp endpoint
    await storePage.phoneInput.fill('9640404455');
    const [sendReq, sendRes] = await Promise.all([
      page.waitForRequest((req) => req.url().includes('/api/v1/verification/whatsapp/send-otp')),
      page.waitForResponse((res) => res.url().includes('/api/v1/verification/whatsapp/send-otp')),
      page.getByTestId('verify-whatsapp-button').click(),
    ]);

    expect(sendReq.postDataJSON().phone).toBe('+919640404455');
    await expect(storePage.phoneInput).toHaveValue('+919640404455');

    // Without live QR-linked phone, real backend returns 503 disconnected -> crisp error shown, NO fake OTP box
    expect(sendRes.status()).toBe(503);
    await expect(page.getByTestId('whatsapp-otp-error')).toContainText(/not connected/i);
    await expect(page.getByTestId('whatsapp-otp-input')).toHaveCount(0);
    await expect(storePage.placeOrderBtn).toBeDisabled();

    // Switching back to Email OTP restores Email flow cleanly
    await page.getByTestId('select-channel-email').click();
    await expect(page.getByTestId('verify-email-button')).toBeVisible();
    await expect(storePage.placeOrderBtn).toBeEnabled();
  });

  test('3. WhatsApp OTP UI handles rate limits/network errors, verifies 6-digit OTP via backend response, enables Place Order, and submits order (mocked browser bridge)', async ({
    storePage,
    page,
  }) => {
    await page.route('**/api/v1/verification/whatsapp/availability', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          enabled: true,
          experimental: true,
          provider: 'berryprotocol',
          connected: true,
          available: true,
          message: 'Experimental WhatsApp OTP verification is online.',
        }),
      });
    });

    let sendAttempts = 0;
    await page.route('**/api/v1/verification/whatsapp/send-otp', async (route) => {
      sendAttempts += 1;
      const reqBody = route.request().postDataJSON();
      expect(reqBody.phone).toBe('+919640404455');

      if (sendAttempts === 1) {
        await route.fulfill({
          status: 429,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Please wait 30 seconds before resending a WhatsApp OTP.' }),
        });
        return;
      }

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          session_id: 'WVS_E2E_MOCK_001',
          phone_masked: '+91 ******4455',
          provider: 'berryprotocol',
          experimental: true,
          delivery_status: 'sent',
          provider_message_id: 'MOCK_MSG_1',
          message: 'Verification code submitted via WhatsApp (sent).',
          expires_in_seconds: 300,
          resend_count: 0,
          cooldown_seconds: 30,
        }),
      });
    });

    await page.route('**/api/v1/verification/whatsapp/verify-otp', async (route) => {
      const body = route.request().postDataJSON();
      expect(body.phone).toBe('+919640404455');
      if (body.otp !== '654321') {
        await route.fulfill({
          status: 400,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Invalid WhatsApp OTP. 2 attempt(s) remaining.' }),
        });
        return;
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 'VERIFIED',
          session_id: 'WVS_E2E_MOCK_001',
          phone_masked: '+91 ******4455',
          verified: true,
          verified_at: '2026-11-25T12:00:00Z',
          verification_token: 'mock-wa-verified-token',
          message: 'WhatsApp number verified successfully.',
        }),
      });
    });

    let capturedOrderPayload: Record<string, any> | null = null;
    await page.route('**/api/v1/store/orders', async (route) => {
      capturedOrderPayload = route.request().postDataJSON();
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          order_id: 'STK-ORD-MOCKWA01',
          status: 'PENDING_PAYMENT',
          subtotal: 99,
          delivery_fee: 50,
          total_amount: 149,
          currency: 'INR',
          order_token: 'mock-order-token',
          contact_verification_channel: 'whatsapp',
          whatsapp_verified: true,
          email_verified: false,
          items: [],
          delivery: capturedOrderPayload?.delivery,
          created_at: '2026-11-25T12:00:00Z',
        }),
      });
    });

    await storePage.openCatalog();
    await storePage.addItemToCartFromCard('STK-001');
    await storePage.openCart();
    await storePage.proceedToCheckoutBtn.click();
    await page.waitForURL('**/checkout');

    await page.getByTestId('select-channel-whatsapp').click();
    await storePage.fillDeliveryDetails(
      {
        fullName: 'Vikram Rao',
        phone: '9640404455',
        email: 'vikram@stickora-test.demo',
        address: '88 Lavelle Road',
        city: 'Bengaluru',
        state: 'Karnataka',
        pincode: '560001',
      },
      false
    );

    await expect(storePage.placeOrderBtn).toBeDisabled();

    // First click hits 429 rate-limit -> error displayed, OTP input stays hidden
    await page.getByTestId('verify-whatsapp-button').click();
    await expect(page.getByTestId('whatsapp-otp-error')).toContainText(/wait 30 seconds/i);
    await expect(page.getByTestId('whatsapp-otp-input')).toHaveCount(0);

    // Second click succeeds -> E.164 normalization applied & OTP input opens
    await page.getByTestId('verify-whatsapp-button').click();
    await expect(storePage.phoneInput).toHaveValue('+919640404455');
    await expect(page.getByTestId('whatsapp-otp-box')).toBeVisible();
    await expect(page.getByTestId('resend-whatsapp-otp-button')).toBeDisabled();

    // Incorrect OTP displays error and keeps Place Order disabled
    await page.getByTestId('whatsapp-otp-input').fill('000000');
    await page.getByTestId('confirm-whatsapp-otp-button').click();
    await expect(page.getByTestId('whatsapp-otp-error')).toContainText(/Invalid WhatsApp OTP/i);
    await expect(storePage.placeOrderBtn).toBeDisabled();

    // Correct OTP shows verified badge and enables Place Order
    await page.getByTestId('whatsapp-otp-input').fill('654321');
    await page.getByTestId('confirm-whatsapp-otp-button').click();
    await expect(page.getByTestId('whatsapp-verified-badge')).toBeVisible();
    await expect(storePage.placeOrderBtn).toBeEnabled();

    await storePage.submitOrder();
    await page.waitForURL('**/payment?order_id=STK-ORD-MOCKWA01*');
    expect(capturedOrderPayload?.contact_verification_channel).toBe('whatsapp');
    expect(capturedOrderPayload?.whatsapp_verification_session_id).toBe('WVS_E2E_MOCK_001');
    expect(capturedOrderPayload?.whatsapp_verification_token).toBe('mock-wa-verified-token');
  });
});
