import { chromium } from 'playwright';

async function testTypography() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  console.log('--- 1. Testing Desktop Typography on Homepage ---');
  await page.goto('http://localhost:3001', { waitUntil: 'networkidle' });

  // Evaluate computed styles on key elements
  const desktopStyles = await page.evaluate(() => {
    const getStyle = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        lineHeight: cs.lineHeight,
      };
    };

    return {
      heroTitle: getStyle('.hero-title'),
      sectionTitle: getStyle('.section-title'),
      productName: getStyle('.product-name'),
      storeNavLink: getStyle('.store-nav-link'),
      categoryPill: getStyle('.category-pill'),
      badge: getStyle('.badge'),
      heroTagBadge: getStyle('.hero-tag-badge'),
      heroBtn: getStyle('.hero-btn-primary'),
      heroSubtitle: getStyle('.hero-subtitle'),
      footerHeading: getStyle('.footer-col h4'),
    };
  });

  console.log('Desktop Styles:', JSON.stringify(desktopStyles, null, 2));

  console.log('\n--- 2. Testing Mobile Typography on Homepage (375x667) ---');
  await page.setViewportSize({ width: 375, height: 667 });
  await page.waitForTimeout(300);

  const mobileStyles = await page.evaluate(() => {
    const getStyle = (selector) => {
      const el = document.querySelector(selector);
      if (!el) return null;
      const cs = window.getComputedStyle(el);
      return {
        fontFamily: cs.fontFamily,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
      };
    };

    return {
      heroTitle: getStyle('.hero-title'),
      sectionTitle: getStyle('.section-title'),
      productName: getStyle('.product-name'),
      storeNavLink: getStyle('.store-nav-link'),
      categoryPill: getStyle('.category-pill'),
      badge: getStyle('.badge'),
      heroTagBadge: getStyle('.hero-tag-badge'),
      heroBtn: getStyle('.hero-btn-primary'),
      heroSubtitle: getStyle('.hero-subtitle'),
      footerHeading: getStyle('.footer-col h4'),
    };
  });

  console.log('Mobile Styles:', JSON.stringify(mobileStyles, null, 2));

  console.log('\n--- 3. Testing Catalogue & Detail & Checkout Typography ---');
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('http://localhost:3001/products', { waitUntil: 'networkidle' });

  const catalogueStyles = await page.evaluate(() => {
    const el = document.querySelector('.catalogue-heading');
    return el ? { fontFamily: window.getComputedStyle(el).fontFamily, fontSize: window.getComputedStyle(el).fontSize } : null;
  });
  console.log('Catalogue Heading:', catalogueStyles);

  await page.goto('http://localhost:3001/checkout', { waitUntil: 'networkidle' });
  const checkoutStyles = await page.evaluate(() => {
    const title = document.querySelector('.checkout-main-title');
    const label = document.querySelector('.input-label');
    const input = document.querySelector('.input-field');
    const btn = document.querySelector('.btn-verify-email');
    return {
      mainTitle: title ? { fontFamily: window.getComputedStyle(title).fontFamily, fontSize: window.getComputedStyle(title).fontSize } : null,
      label: label ? { fontFamily: window.getComputedStyle(label).fontFamily, fontSize: window.getComputedStyle(label).fontSize } : null,
      input: input ? { fontFamily: window.getComputedStyle(input).fontFamily, fontSize: window.getComputedStyle(input).fontSize } : null,
      btn: btn ? { fontFamily: window.getComputedStyle(btn).fontFamily, fontSize: window.getComputedStyle(btn).fontSize } : null,
    };
  });
  console.log('Checkout Styles:', checkoutStyles);

  await browser.close();
}

testTypography().catch((err) => {
  console.error('Error testing typography:', err);
  process.exit(1);
});
