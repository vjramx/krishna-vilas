import { readFileSync } from 'node:fs';

/**
 * One-off: clear every order (and only its dependent rows) from the live
 * Krishna Vilas project. Scoped exactly like migration 0016's
 * admin_delete_all_orders does, executed as a single transaction so no
 * half-cleared state can persist. Nothing else (menu, categories, settings,
 * admin/agent accounts, audit log) is touched.
 *
 * Usage: SB_TOKEN=$(cat .tmp/sb-token) node scripts/clear-orders.mjs
 */

const REF = 'reodbsfxkorpgzimqijn';
const TOKEN = process.env.SB_TOKEN ?? '';
if (!TOKEN) {
  console.error('SB_TOKEN missing');
  process.exit(1);
}

async function adminQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (res.status !== 200 && res.status !== 201) throw new Error(`query failed (${res.status}): ${body.slice(0, 400)}`);
  return JSON.parse(body);
}

const before = await adminQuery('select count(*)::int as orders from public.orders');
console.log('orders before:', before[0]?.orders ?? 'n/a');
if ((before[0]?.orders ?? 0) === 0) {
  console.log('NOTHING TO DELETE — orders table already empty. No destructive action performed.');
  process.exit(0);
}

await adminQuery(`
begin;
  insert into public.audit_log (actor_email, action, target_type, details)
  values ('[management-api-on-owner-request]', 'orders.bulk_delete', 'orders', jsonb_build_object('source', 'scripts/clear-orders.mjs'));
  delete from public.order_items where order_id in (select id from public.orders);
  delete from public.order_status_history where order_id in (select id from public.orders);
  delete from public.orders;
commit;
`);

const [orders, items, history, menu, totals] = await Promise.all([
  adminQuery('select count(*)::int as n from public.orders'),
  adminQuery('select count(*)::int as n from public.order_items'),
  adminQuery('select count(*)::int as n from public.order_status_history'),
  adminQuery('select count(*)::int as n from public.menu_items'),
  adminQuery("select count(*)::int as n from public.audit_log where action = 'orders.bulk_delete'"),
]);

console.log('orders after:', orders[0]?.n, '(must be 0)');
console.log('order_items remaining:', items[0]?.n, '(must be 0)');
console.log('order_status_history remaining:', history[0]?.n, '(must be 0)');
console.log('menu_items intact:', menu[0]?.n);
console.log('bulk-delete audit rows:', totals[0]?.n, '(must be 1)');

const ok = (orders[0]?.n ?? 1) === 0 && (items[0]?.n ?? 1) === 0 && (history[0]?.n ?? 1) === 0;
console.log(ok ? '\nALL ORDERS CLEARED' : '\nVERIFICATION MISMATCH — inspect the project before using the app');
process.exit(ok ? 0 : 1);
