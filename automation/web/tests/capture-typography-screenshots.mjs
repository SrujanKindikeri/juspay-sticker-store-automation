import { chromium } from 'playwright';
import path from 'path';

const ARTIFACT_DIR = 'C:/Users/kindi/.gemini/antigravity/brain/87694b98-e97d-499e-a0fa-c843465b4bf9';

async function captureScreenshots() {
  const browser = await chromium.launch({ headless: true });

  // 1. Desktop Context (1920x1080)
  const desktopContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const desktopPage = await desktopContext.newPage();

  console.log('Capturing Desktop Homepage...');
  await desktopPage.goto('http://localhost:3001', { waitUntil: 'networkidle' });
  await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, 'typography-homepage-desktop.png'), fullPage: false });

  console.log('Capturing Desktop Catalogue...');
  await desktopPage.goto('http://localhost:3001/products', { waitUntil: 'networkidle' });
  await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, 'typography-catalogue-desktop.png'), fullPage: false });

  console.log('Capturing Desktop Checkout...');
  // Add item to cart first so checkout form displays
  await desktopPage.goto('http://localhost:3001/products/STK-001', { waitUntil: 'networkidle' });
  const addToCartBtn = await desktopPage.waitForSelector('.add-to-cart-btn, [data-testid^="add-to-cart"]');
  await addToCartBtn.click();
  await desktopPage.waitForTimeout(600);
  await desktopPage.goto('http://localhost:3001/checkout', { waitUntil: 'networkidle' });
  await desktopPage.screenshot({ path: path.join(ARTIFACT_DIR, 'typography-checkout-desktop.png'), fullPage: false });

  // 2. Mobile Context (375x812)
  const mobileContext = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const mobilePage = await mobileContext.newPage();

  console.log('Capturing Mobile Homepage...');
  await mobilePage.goto('http://localhost:3001', { waitUntil: 'networkidle' });
  await mobilePage.screenshot({ path: path.join(ARTIFACT_DIR, 'typography-homepage-mobile.png'), fullPage: false });

  await browser.close();
  console.log('All screenshots captured successfully.');
}

captureScreenshots().catch(err => {
  console.error('Screenshot capture failed:', err);
  process.exit(1);
});
