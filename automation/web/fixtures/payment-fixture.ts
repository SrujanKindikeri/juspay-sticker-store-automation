import { test as base, expect } from '@playwright/test';
import { CheckoutPage } from '../pages/CheckoutPage';
import { OtpPage } from '../pages/OtpPage';
import { ResultPage } from '../pages/ResultPage';
import { StorePage } from '../pages/StorePage';
import { closeDbPool } from '../utils/db';

type PaymentFixtures = {
  checkoutPage: CheckoutPage;
  otpPage: OtpPage;
  resultPage: ResultPage;
  storePage: StorePage;
};

export const test = base.extend<PaymentFixtures>({
  checkoutPage: async ({ page }, use) => {
    await use(new CheckoutPage(page));
  },
  otpPage: async ({ page }, use) => {
    await use(new OtpPage(page));
  },
  resultPage: async ({ page }, use) => {
    await use(new ResultPage(page));
  },
  storePage: async ({ page }, use) => {
    await use(new StorePage(page));
  },
});

export { expect };
