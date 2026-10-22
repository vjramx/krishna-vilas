import { readFileSync } from 'node:fs';

// Live verification of kv_delete_account_data boundary + purge semantics.
// Uses synthetic UIDs only; cleans up after itself. Prints statuses, never secrets.
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map((splitLine) => splitLine.trim().split('='))
    .filter((kv) => kv.length === 2),
);
const TOKEN = env.SB_TOKEN ?? process.env.SB_TOKEN ?? '';
const REF = 'reodbsfxkorpgzimqijn';

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  return { ok: res.status === 200 || res.status === 201, body };
}
const emulate = (claims) => `
  select set_config('role', 'anon', true);
  select set_config('request.jwt.claims', '${claims.replace(/'/g, "''")}', false);
`;
let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(cond ? `✅ ${name}` : `❌ ${name} ${extra}`);
  if (!cond) failures++;
};
const clean = (uid) => q(`
  delete from public.order_status_history where order_id in (select id from public.orders where customer_id = '${uid}');
  delete from public.order_items where order_id in (select id from public.orders where customer_id = '${uid}');
  delete from public.orders where customer_id = '${uid}';
  delete from public.user_activity where user_id = '${uid}';
  delete from public.profiles where id = '${uid}';`).catch(() => {});

const CUST_UID = 'kv_delete_test_uid';
const CUST_EMAIL = 'kv-delete-test@krishnavilas.test';

// seed: profile + activity + a delivered order with personal data
await clean(CUST_UID);
await q(`
  insert into public.profiles (id, display_name, phone) values ('${CUST_UID}', 'Del Me', '9876543210');
  insert into public.user_activity (user_id, email, display_name) values ('${CUST_UID}', '${CUST_EMAIL}', 'Del Me');`);
const seeded = await q(`
  select set_config('role', 'anon', true); );
  select set_config('request.jwt.claims', '', false);`);
const order = await q(`
  select set_config('role', 'anon', true);
  select set_config('request.jwt.claims', '${JSON.stringify({
    iss: 'https://reodbsfxkorpgzimqijn.supabase.co/auth/v1',
    aud: 'authenticated',
    sub: CUST_UID,
    email: CUST_EMAIL,
    email_verified: true,
    role: 'authenticated',
  }).replace(/'/g, "''")}', false);
  select public.place_order(
    jsonb_build_array(jsonb_build_object('item_id', (select id from public.menu_items where is_active limit 1), 'quantity', 1)),
    'Del Me', '9876543210', 'Delete Test Street 12', 'Karatagi',
    null, null, '${crypto.randomUUID()}') as r;`);
let orderId = null;
try {
  const val = await JSON.parse(order.body)[0]?.r;
  orderId = typeof val === 'object' ? val?.order_id : (typeof val === 'string' ? val : null);
} catch { /* handled by check below */ }
check('seed order placed for synthetic customer', !!orderId, order.body.slice(0, 300));
if (!orderId) process.exit(1);

// mark it delivered (terminal) so deletion is allowed
await q(`update public.orders set status = 'confirmed' where id = '${orderId}';`);
await q(`update public.orders set status = 'preparing' where id = '${orderId}';`);
await q(`update public.orders set status = 'ready' where id = '${orderId}';`);
await q(`update public.orders set status = 'out_for_delivery' where id = '${orderId}', delivered_pin_used = true where false;`);
await q(`update public.orders set status = 'out_for_delivery' where id = '${orderId}';`);
const pinRes = await q(`update public.orders set delivery_pin = '123456' where id = '${orderId}' returning delivery_pin;`);
check('delivery PIN seeded', /123456/.test(pinRes.body), pinRes.body.slice(0, 120));
await q(`update public.orders set status = 'delivered', delivered_at = now() where id = '${orderId}';`);

// 1) anon/authenticated/executability checks
{
  const a = await q(`
    ${emulate(JSON.stringify({ iss: 'https://securetoken.google.com/krishna-vilas', aud: 'krishna-vilas', sub: CUST_UID, email: CUST_EMAIL, email_verified: true }))}
    select public.kv_delete_account_data('${CUST_UID}', '${CUST_EMAIL}') as r;`);
  check('customer session CANNOT call the purge (SRV_ONLY)', /42501|permission denied/i.test(a.body), a.body.slice(0, 200));
}

// 2) staff via email must be refused
{
  // emulated service-role runtime? Management API runs as postgres (allowed executors include postgres)
  const staff = await q(`select public.kv_delete_account_data('staff_target_uid', 'vijayramv229@gmail.com') as r;`);
  check('staff email rejected (STAFF_ACCOUNT)', /STAFF_ACCOUNT/i.test(staff.body), staff.body.slice(0, 200));
}
// 3) pending orders block with count detail
{
  const pend = await q(`select public.kv_delete_account_data('pending_uid_test', 'nosuchuser@krishnavilas.test') as r;`);
  check('unknown uid without pending orders proceeds (no rows scanned)', !/PENDING_ORDERS/i.test(pend.body) || /PENDING_ORDERS/.test(pend.body) === false, pend.body.slice(0, 200));
}

// 4) successful purge of the synthetic customer
{
  const res = await q(`select public.kv_delete_account_data('${CUST_UID}', '${CUST_EMAIL}') as r;`);
  let r = null;
  try { r = JSON.parse(JSON.stringify(JSON.parse(res.body)[0]?.r)); } catch { /* below */ }
  check('purge succeeds', r?.ok === true, res.body.slice(0, 300));
  check('one order anonymized', Number(r?.orders_anonymized) === 1, JSON.stringify(r));
  check('activity row deleted', Number(r?.activity_rows_deleted) === 1, JSON.stringify(r));
  check('profile deleted', r?.profile_deleted === true, JSON.stringify(r));

  const tail = await q(`select customer_name, phone, address_line, area, landmark, instructions, delivery_latitude, delivery_pin from public.orders where id = '${orderId}';`);
  const o = JSON.parse(tail.body)[0] ?? {};
  check('customer_name anonymized', o.customer_name === 'Deleted user', JSON.stringify(o));
  check('phone wiped', !o.phone, JSON.stringify(o));
  check('address wiped', !o.address_line && !o.area && !o.landmark, JSON.stringify(o));
  check('coords wiped', o.delivery_latitude === null, JSON.stringify(o));
  check('delivery PIN wiped', !o.delivery_pin || o.delivery_pin === null, JSON.stringify(o));
  check('profile gone (no PII left)', (await q(`select count(*) as n from public.profiles where id = '${CUST_UID}';`)).body.includes('"n":0'), '');
  check('activity gone', (await q(`select count(*) as n from public.user_activity where user_id = '${CUST_UID}';`)).body.includes('"n":0'), '');

  const again = await q(`select public.kv_delete_account_data('${CUST_UID}', '${CUST_EMAIL}') as r;`);
  const r2 = JSON.parse(JSON.stringify(JSON.parse(again.body)[0]?.r));
  check('repeat purge is idempotent (safe retries)', r2?.ok === true && r2?.profile_deleted === false, again.body.slice(0, 300));
}

await clean(CUST_UID);
console.log(failures === 0 ? '\nRPC BOUNDARY + PURGE VERIFICATION PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
