/**
 * Android app-feel checks against a running build (npm run preview).
 *
 *   node scripts/app-ux-check.mjs
 *
 * Verifies the things that make this read as a native app rather than a web
 * page: touch target sizes, bottom-nav clearance, no horizontal scroll, the
 * add-to-cart snackbar, hardware-back closing a sheet, and pull-to-refresh.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.BASE_URL ?? 'http://localhost:4173';
const PHONE = { width: 390, height: 844 };

mkdirSync('coverage/shots', { recursive: true });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({
  viewport: PHONE,
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Mobile Safari/537.36',
});
const page = await ctx.newPage();

let failures = 0;
const log = (...a) => console.log(...a);
const check = (name, ok, extra = '') => {
  if (ok) log(`✅ ${name}`);
  else {
    failures++;
    log(`❌ ${name} ${extra}`);
  }
};

page.on('pageerror', (e) => {
  failures++;
  log(`❌ page error: ${e.message.slice(0, 160)}`);
});

await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('h3', { timeout: 20000 });
await page.waitForTimeout(800);

/* ------------------------------------------------------- layout integrity */
const metrics = await page.evaluate(() => {
  const de = document.documentElement;
  const nav = document.querySelector('nav[aria-label="Primary"]');
  const navRect = nav?.getBoundingClientRect();
  const smallTargets = [];
  for (const el of document.querySelectorAll('button, a[href], [role="tab"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < 34 || r.width < 34) {
      smallTargets.push(`${el.tagName.toLowerCase()}:${(el.getAttribute('aria-label') || el.textContent || '?').trim().slice(0, 22)} ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }
  const wide = [...document.querySelectorAll('*')]
    .filter((el) => el.getBoundingClientRect().width > de.clientWidth + 1)
    .slice(0, 3)
    .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 40)}`);
  return {
    hOverflow: de.scrollWidth - de.clientWidth,
    navTop: navRect ? Math.round(navRect.top) : null,
    navHeight: navRect ? Math.round(navRect.height) : null,
    docHeight: de.scrollHeight,
    viewportHeight: window.innerHeight,
    smallTargets,
    wide,
  };
});

check('no horizontal page scroll', metrics.hOverflow <= 1, `overflow=${metrics.hOverflow}px`);
check('bottom tab bar is pinned to the bottom', metrics.navTop !== null && metrics.navTop + metrics.navHeight >= PHONE.height - 2, JSON.stringify(metrics));
check('bottom tab bar height ≤ 76 (no wasted chrome)', (metrics.navHeight ?? 99) <= 76, `h=${metrics.navHeight}`);
check('no touch target under 34px', metrics.smallTargets.length === 0, metrics.smallTargets.slice(0, 4).join(' | '));
check('nothing wider than the viewport', metrics.wide.length === 0, metrics.wide.join(' | '));

/* ------------------------------------------- bottom nav never hides content */
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
await page.waitForTimeout(400);
const clearance = await page.evaluate(() => {
  const nav = document.querySelector('nav[aria-label="Primary"]');
  const navTop = nav ? nav.getBoundingClientRect().top : window.innerHeight;
  const last = document.querySelector('main p:last-of-type');
  return { navTop, lastBottom: last ? last.getBoundingClientRect().bottom : 0, atEnd: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 4 };
});
check('last content clears the tab bar when scrolled to the end', !clearance.atEnd || clearance.lastBottom <= clearance.navTop, JSON.stringify(clearance));
await page.evaluate(() => window.scrollTo(0, 0));

/* -------------------------------------------------------- snackbar + cart */
const addButton = page.locator('button:has-text("Add")').first();
await addButton.click();
await page.waitForTimeout(350);
const snack = await page.locator('[role="status"]').filter({ hasText: /added to cart/i }).first().isVisible().catch(() => false);
check('add-to-cart shows a snackbar', snack);
const stepperVisible = await page.locator('span[aria-live="polite"]').first().isVisible().catch(() => false);
check('tile switches to a stepper after adding', stepperVisible);
const badge = await page
  .locator('nav[aria-label="Primary"] a[href="/cart"] span.absolute')
  .first()
  .textContent()
  .catch(() => null);
check('bottom-tab cart badge shows a count', !!badge && /\d/.test(badge), `badge=${badge}`);
await page.screenshot({ path: 'coverage/shots/app-menu-390.png' });

/* ----------------------------------------- hardware back closes a bottom sheet */
await page.locator('h3').first().click();
await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
check('item detail opens as a bottom sheet', await page.locator('[role="dialog"]').isVisible());
await page.screenshot({ path: 'coverage/shots/app-sheet-390.png' });
await page.goBack();
await page.waitForTimeout(400);
const sheetGone = (await page.locator('[role="dialog"]').count()) === 0;
check('hardware back closes the sheet (stays on the menu)', sheetGone && new URL(page.url()).pathname === '/', page.url());

/* ------------------------------------------------------------- pull refresh */
const cdp = await ctx.newCDPSession(page);
await page.evaluate(() => window.scrollTo(0, 0));
await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 195, y: 320 }] });
for (const y of [360, 420, 480, 540]) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 195, y }] });
  await page.waitForTimeout(40);
}
await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
await page.waitForTimeout(250);
const ptrSpinning = await page.locator('svg.ptr-spinning').count();
check('pull-to-refresh engages its spinner', ptrSpinning > 0, `spinners=${ptrSpinning}`);
await page.waitForTimeout(1600);

/* ------------------------------------------------------------ cart + checkout */
await page.goto(`${BASE}/cart`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
const cartBar = await page.locator('a[href="/checkout"]').boundingBox();
check('cart keeps a sticky checkout bar on screen', !!cartBar && cartBar.y + cartBar.height <= PHONE.height, JSON.stringify(cartBar));
await page.screenshot({ path: 'coverage/shots/app-cart-390.png' });

await page.goto(`${BASE}/checkout`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(700);
const checkoutSignIn = page.locator('[data-sticky-bar] a[href="/login?next=%2Fcheckout"]');
await checkoutSignIn.waitFor({ state: 'visible' });
const payBtn = await checkoutSignIn.boundingBox();
check('signed-out checkout keeps the sign-in action on screen', !!payBtn && payBtn.y + payBtn.height <= PHONE.height, JSON.stringify(payBtn));
check('guests cannot submit an unauthenticated order', await page.locator('button[form="checkout-form"]').count() === 0);
await page.locator('#ck-name').fill('Draft Customer');
await page.locator('#ck-address').fill('Village road 12');
await page.locator('input[type="checkbox"]').uncheck();
await checkoutSignIn.click();
check('checkout sign-in carries its return destination', new URL(page.url()).searchParams.get('next') === '/checkout');
await page.goBack();
await page.locator('#ck-name').waitFor();
check('delivery draft survives the sign-in round trip', await page.locator('#ck-name').inputValue() === 'Draft Customer' && await page.locator('#ck-address').inputValue() === 'Village road 12');
await page.reload();
await page.locator('#ck-name').waitFor();
check('draft and save preference survive reload', await page.locator('#ck-name').inputValue() === 'Draft Customer' && !(await page.locator('input[type="checkbox"]').isChecked()));
await page.screenshot({ path: 'coverage/shots/app-checkout-390.png' });

/* --------------------------------------------- every screen on a phone viewport */
const ROUTES = [
  ['/', 'menu'],
  ['/cart', 'cart'],
  ['/checkout', 'checkout'],
  ['/orders', 'orders'],
  ['/account', 'account'],
  ['/login', 'login'],
  ['/admin/login', 'admin sign-in'],
  ['/agent/login', 'agent sign-in'],
  ['/admin', 'admin gate'],
  ['/agent', 'agent gate'],
  ['/agent/preview', 'agent preview gate'],
  ['/nope', 'not-found redirect'],
];
for (const [route, label] of ROUTES) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(700);
  const info = await page.evaluate(() => {
    const de = document.documentElement;
    const wide = [...document.querySelectorAll('main *')]
      .filter((el) => el.getBoundingClientRect().width > de.clientWidth + 1)
      .slice(0, 2)
      .map((el) => `${el.tagName.toLowerCase()}.${(el.className || '').toString().slice(0, 30)}`);
    return { overflow: de.scrollWidth - de.clientWidth, wide };
  });
  check(`${label}: fits a 390px phone`, info.overflow <= 1 && info.wide.length === 0, `overflow=${info.overflow} ${info.wide.join(' | ')}`);
}

/* -------------------------------------------- sticky search stays under the app bar */
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h3', { timeout: 20000 });
await page.evaluate(() => window.scrollTo(0, 600));
await page.waitForTimeout(400);
const sticky = await page.evaluate(() => {
  const header = document.querySelector('header');
  const search = document.querySelector('input[type="search"]');
  if (!header || !search) return null;
  // Walk up to the sticky wrapper (the search input itself sits inside its padding).
  let node = search;
  while (node && getComputedStyle(node).position !== 'sticky') node = node.parentElement;
  if (!node) return null;
  return {
    headerBottom: Math.round(header.getBoundingClientRect().bottom),
    barTop: Math.round(node.getBoundingClientRect().top),
  };
});
check(
  'search bar sticks flush under the app bar (no gap, no overlap)',
  !!sticky && Math.abs(sticky.barTop - sticky.headerBottom) <= 2,
  JSON.stringify(sticky),
);

/* ------------------------------------------------------- Kannada stays mobile-safe */
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h3', { timeout: 20000 });
await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'ಕನ್ನಡ', exact: true }).click();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h3', { timeout: 20000 });
const kannada = await page.evaluate(() => {
  const de = document.documentElement;
  return {
    overflow: de.scrollWidth - de.clientWidth,
    hasKannada: /[\u0C80-\u0CFF]/.test(document.body.innerText),
  };
});
check('Kannada settings choice switches the UI language', kannada.hasKannada);
check('Kannada layout still fits the phone', kannada.overflow <= 1, `overflow=${kannada.overflow}px`);
await page.screenshot({ path: 'coverage/shots/app-menu-kn-390.png' });
await page.goto(`${BASE}/account`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'English', exact: true }).click();
await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('h3', { timeout: 20000 });

/* ------------------------------------------------------------- no splash */
const splash = await page.locator('#boot-splash').count();
check('launch splash is not rendered', splash === 0);

await browser.close();
log(failures === 0 ? '\nAPP UX CHECKS PASSED' : `\n${failures} APP UX CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
