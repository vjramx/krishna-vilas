import { chromium } from 'playwright-core';

const base = process.env.BASE_URL ?? 'http://localhost:5174';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const items = [{ id: 'idli', category_id: 'breakfast', name_en: 'Idli', name_kn: 'ಇಡ್ಲಿ', price: '30', is_available: true, is_active: true, is_vegetarian: true }];
  await page.route('**/rest/v1/**', async (route) => {
    const table = new URL(route.request().url()).pathname.split('/').filter(Boolean).pop();
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(table === 'menu_items' ? items : [{ id: 'breakfast', name_en: 'Breakfast' }]),
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
  const html = await page.evaluate(() => document.body.innerHTML);
  console.log(html.slice(0, 4000));
  console.log('SWITCH_COUNT', await page.getByRole('switch').count());
  console.log('BUTTON_COUNT', await page.getByRole('button').count());
  for (const n of await page.getByRole('button').all()) console.log('BUTTON_NAME:', await n.getAttribute('aria-label'), '|', (await n.textContent() ?? '').slice(0, 40));
} finally {
  await browser.close();
}
