import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];

mkdirSync('coverage/shots', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });

let failures = 0;
for (const width of WIDTHS) {
  const isMobile = width <= 430;
  const ctx = await browser.newContext({
    viewport: { width, height: width <= 800 ? 800 : width },
    hasTouch: isMobile,
    isMobile,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 120)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/error during realtime|realtime|favicon/i.test(m.text())) {
      errors.push(m.text().slice(0, 140));
    }
  });

  // 1) Menu page
  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (overflow > 1) {
      failures++;
      console.log(`❌ ${width}px: horizontal overflow ${overflow}px on menu`);
    } else {
      console.log(`✅ ${width}px: no horizontal overflow on menu`);
    }
    const cards = await page.locator('h3').count();
    console.log(`   menu headings: ${cards}`);
    await page.screenshot({ path: `coverage/shots/menu-${width}.png`, fullPage: false });

    // 2) Cart empty state
    await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(600);
    const cartOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (cartOverflow > 1) {
      failures++;
      console.log(`❌ ${width}px: overflow ${cartOverflow}px on cart`);
    } else {
      console.log(`✅ ${width}px: no overflow on cart`);
    }
    await page.screenshot({ path: `coverage/shots/cart-${width}.png` });
  } catch (e) {
    failures++;
    console.log(`❌ ${width}px: navigation error ${e.message.slice(0, 120)}`);
  }

  if (errors.length) {
    console.log(`   ⚠ ${width}px page errors: ${[...new Set(errors)].slice(0, 3).join(' | ')}`);
  }
  await ctx.close();
}

// Functional: attempt checkout visibility at 360px
const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1500);
const checkoutBtn = page.locator('button[type=submit]');
const visible = await checkoutBtn.isVisible().catch(() => false);
const box = visible ? await checkoutBtn.boundingBox() : null;
const inViewport = box && box.y + box.height < 780 && box.x >= 0 && box.x + box.width <= 360;
console.log(visible ? 'checkout submit button visible' : 'checkout submit button NOT visible');
if (box) await page.evaluate(() => document.querySelector('button[type=submit]')?.scrollIntoView({ block: 'center' }));

// Bottom nav must not overlap content permanently: check its height vs page scroll
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForTimeout(1800);
const nav = await page.locator('nav[aria-label=Primary]').boundingBox();
console.log(nav ? `bottom nav: y=${Math.round(nav.y)} h=${Math.round(nav.height)} (viewport 780)` : 'no bottom nav found at 360');

await page.screenshot({ path: 'coverage/shots/menu-360-mobile.png' });
await ctx.close();

await browser.close();
console.log(failures === 0 ? 'VIEWPORT SWEEP PASSED' : `VIEWPORT SWEEP: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
