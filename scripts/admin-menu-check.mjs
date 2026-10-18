import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

// Needs the Vite dev server (not preview) to load the isolated component harness.
const base = process.env.BASE_URL ?? 'http://localhost:5201';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on('pageerror', (error) => { errors.push(error.message); console.error(error.message); });
  let fail = false;
  const items = [{ id: 'idli', category_id: 'breakfast', name_en: 'Idli', name_kn: 'ಇಡ್ಲಿ', price: '30', is_available: true, is_active: true }];
  await page.route('**/rest/v1/**', async (route) => {
    const table = new URL(route.request().url()).pathname.split('/').pop();
    await route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(
      fail ? { message: 'Network unavailable' } : table === 'menu_items' ? items : [{ id: 'breakfast', name_en: 'Breakfast' }],
    ) });
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
  assert.equal(await page.getByRole('switch').count(), 1);
  assert.equal(await page.getByRole('status').count(), 0);
  console.log('PASS: Strict Mode renders the admin menu and clears its spinner');
  fail = true;
  await page.reload();
  await page.getByRole('alert').waitFor();
  assert.equal(await page.getByRole('status').count(), 0);
  fail = false;
  await page.getByRole('button', { name: 'Retry' }).click();
  await page.getByText('Idli', { exact: true }).waitFor();
  console.log('PASS: failed fetch shows an error; Retry loads items');
  await page.getByRole('button', { name: 'Edit item: Idli' }).click();
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.getByLabel('Name (English)').inputValue(), 'Idli');
  console.log('PASS: loaded item opens in the edit sheet');
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
