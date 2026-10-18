import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// Isolated harness for the ADMIN EDIT FLOW reported broken by the owner:
// click "Edit item" -> sheet opens with the item's data -> submit edit -> row updated.
// Needs the Vite dev server (component is imported from source by Vite).
const base = process.env.BASE_URL ?? 'http://localhost:5201';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error('PAGEERROR', error.message); });

  let failMenu = false;
  // Real PostgREST returns numeric columns as JSON numbers, which used to
  // crash the AdminMenu discount memo with `value.trim is not a function`.
  const items = [{ id: 'idli', category_id: 'breakfast', name_en: 'Idli', name_kn: 'ಇಡ್ಲಿ', price: 30, original_price: 40, is_available: true, is_active: true, is_vegetarian: true }];
  let updatedRows = [];
  await page.route('**/rest/v1/**', async (route) => {
    const method = route.request().method();
    const url = new URL(route.request().url());
    const lastSegment = url.pathname.split('/').filter(Boolean).pop();
    if (method === 'PATCH' && lastSegment === 'menu_items') {
      updatedRows.push(JSON.parse(route.request().postData() ?? '{}'));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(items) });
      return;
    }
    const table = lastSegment;
    await route.fulfill({
      status: failMenu ? 503 : 200,
      contentType: 'application/json',
      body: JSON.stringify(failMenu
        ? { message: 'Network unavailable' }
        : table === 'menu_items' ? items : [{ id: 'breakfast', name_en: 'Breakfast' }]),
    });
  });

  await page.route(`${base}/__admin_menu_check`, (route) => route.fulfill({
    contentType: 'text/html',
    body: `<html><body><div id="test-root"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => (type) => type;
      window.__vite_plugin_react_preamble_installed__ = true;
      await import('/__admin_menu_entry');
    </script></body></html>`,
  }));
  await page.route(`${base}/__admin_menu_entry`, (route) => route.fulfill({
    contentType: 'application/javascript',
    body: `import React from '/node_modules/.vite/deps/react.js';
      import ReactDOM from '/node_modules/.vite/deps/react-dom_client.js';
      import AdminMenu from '/src/pages/admin/AdminMenu.tsx';
      import { LanguageProvider } from '/src/context/LanguageContext.tsx';
      import '/src/index.css';
      ReactDOM.createRoot(document.getElementById('test-root')).render(React.createElement(React.StrictMode, null,
        React.createElement(LanguageProvider, null, React.createElement(AdminMenu))));
    `,
  }));

  await page.goto(`${base}/__admin_menu_check`);
  await page.getByText('Idli', { exact: true }).waitFor();
  console.log('PASS: admin menu renders the item');

  // 1) The edit button exists and is the pencil control.
  const editButton = page.getByRole('button', { name: 'Edit menu item: Idli' });
  await editButton.waitFor({ timeout: 10000 });
  console.log('PASS: Edit item button is present');

  // 2) Clicking it opens the sheet pre-filled with the item's data.
  await editButton.click();
  await page.getByRole('dialog').waitFor({ timeout: 10000 });
  assert.equal(await page.getByLabel('Name (English)').inputValue(), 'Idli');
  console.log('PASS: clicking Edit opens the sheet with existing values');

  // 3) Editing the price and saving issues an UPDATE with the new value.
  await page.getByLabel('Price (₹) *').fill('35');
  await page.getByRole('button', { name: /Save changes/ }).click();
  await page.waitForTimeout(500);
  assert.equal(updatedRows.length, 1, 'expected exactly one PATCH to menu_items');
  assert.equal(String(updatedRows[0].price), '35');
  console.log('PASS: save sent an UPDATE with the edited price');

  await page.waitForTimeout(300);
  assert.deepEqual(errors, [], 'expected no uncaught page errors during the edit flow');
  console.log('PASS: edit flow ran without uncaught page errors');
  console.log('EDIT FLOW OK');
} finally {
  await browser.close();
}
