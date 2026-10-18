import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

// Read anon key + URL from .env (never hardcode secrets in source)
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map((l) => l.trim().split('='))
    .filter((kv) => kv.length === 2),
);
const URL = env.VITE_SUPABASE_URL;
const ANON = env.VITE_SUPABASE_ANON_KEY;
const TOKEN = process.env.SB_TOKEN ?? '';

const REF = 'reodbsfxkorpgzimqijn';
async function adminQuery(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (res.status !== 200 && res.status !== 201) throw new Error(`adminQuery failed: ${body.slice(0, 300)}`);
  return JSON.parse(body);
}

const log = (...a) => console.log(...a);
let failures = 0;
const check = (name, cond, extra = '') => {
  if (cond) log(`✅ ${name}`);
  else {
    failures++;
    log(`❌ ${name} ${extra}`);
  }
};

// ---------------- customer + admin-in-one session ---------------
// The product now signs everyone in with Google in the UI. For CI we simulate
// the confirmed account that Google OAuth would produce (GoTrue admin API),
// then grant the admin role server-side for the privileged-flow tests.
const customer = createClient(URL, ANON);
const testEmail = `e2e-cust-${Date.now() % 1_000_000}@outlook.com.br`;
const testPass = `kv-e2e-${Date.now()}`;
const { data: signup, error: signupErr } = await customer.auth.signUp({
  email: testEmail,
  password: testPass,
});
check('customer signup', !!signup?.user && !signupErr, signupErr?.message ?? '');
if (!signup?.user) process.exit(1);
await new Promise((r) => setTimeout(r, 1500));
const custUid = signup.user.id;

// menu visible to anon/RLS
const { data: menuItems, error: menuErr } = await customer.from('menu_items').select('*').eq('is_active', true).limit(5);
check('menu readable via RLS', Array.isArray(menuItems) && menuItems.length > 0 && !menuErr, menuErr?.message ?? '');
const item = menuItems?.[0];
check('menu item has kn name', !!item?.name_kn, item?.name_en);

// other customers' orders are NOT readable
const { data: foreignOrders } = await customer.from('orders').select('*');
check('orders access restricted to own (empty for new user)', (foreignOrders ?? []).length === 0);

// place an order server-side (trusted pricing)
const { data: settings } = await customer.from('hotel_settings').select('*').eq('id', 1).single();
const { data: placed, error: placeErr } = await customer.rpc('place_order', {
  p_items: [{ item_id: item.id, quantity: 2 }],
  p_customer_name: 'E2E Test',
  p_phone: '9876543210',
  p_address_line: 'Test Address Road 123',
  p_area: 'Test Area',
  p_landmark: null,
  p_instructions: null,
  p_idempotency_key: crypto.randomUUID(),
});
check('order placed via RPC', !!placed?.order_id && !placeErr, JSON.stringify(placeErr));
const expectedTotal = Number(item.price) * 2 + Number(settings.delivery_fee);
check('server-computed total ≈ price*2+fee', Math.abs(Number(placed?.total) - expectedTotal) < 0.01, `${placed?.total} vs ${expectedTotal}`);

// in-app total tampering attempt: direct update by customer must not change anything
const { data: beforeTamper } = await customer.from('orders').select('total').eq('id', placed.order_id).single();
await customer.from('orders').update({ total: 1 }).eq('id', placed.order_id);
const { data: afterTamper } = await customer.from('orders').select('total').eq('id', placed.order_id).single();
check('customer cannot mutate order totals (RLS: 0 rows affected)', Number(afterTamper?.total) === Number(beforeTamper?.total), `${beforeTamper?.total} → ${afterTamper?.total}`);

// duplicate submission returns same order for same idempotency key (needs price ≥ min order)
const { data: pricey } = await customer.from('menu_items').select('id,price').gte('price', 50).limit(1);
if (!pricey?.[0]?.id) {
  console.log('❌ no item above min order total — test data issue');
  process.exit(1);
}
const idem = crypto.randomUUID();
const first = await customer.rpc('place_order', {
  p_items: [{ item_id: pricey[0].id, quantity: 1 }],
  p_customer_name: 'E2E Test',
  p_phone: '9876543210',
  p_address_line: 'Test Address Road 123',
  p_area: 'Test Area',
  p_idempotency_key: idem,
});
const second = await customer.rpc('place_order', {
  p_items: [{ item_id: pricey[0].id, quantity: 1 }],
  p_customer_name: 'E2E Test',
  p_phone: '9876543210',
  p_address_line: 'Test Address Road 123',
  p_area: 'Test Area',
  p_idempotency_key: idem,
});
check('idempotency returns same order id', first.data?.order_id === second.data?.order_id && !!first.data?.order_id, `${first.data?.order_id} vs ${second.data?.order_id}`);
const dupOrderId = first.data?.order_id;
check('first idempotency call succeeded', !!dupOrderId, JSON.stringify(first.error ?? {}) + JSON.stringify(second.error ?? {}));
if (!dupOrderId) process.exit(1);

// ---------------- grant admin role to this session (server-side) ----------------
await adminQuery(`insert into public.admin_users (id, email) values ('${custUid}', '${testEmail}') on conflict (id) do update set email = excluded.email;`);

// admin can read the order and drive transitions
const { data: board } = await customer.from('orders').select('*').eq('id', dupOrderId).single();
check('admin can read the order', board?.id === dupOrderId, `uid=${custUid}`);

let stErr = (await customer.rpc('set_order_status', { p_order_id: dupOrderId, p_new_status: 'confirmed' })).error;
check('admin: confirmed', !stErr, stErr?.message ?? '');
stErr = (await customer.rpc('set_order_status', { p_order_id: dupOrderId, p_new_status: 'preparing' })).error;
check('admin: preparing', !stErr, stErr?.message ?? '');
stErr = (await customer.rpc('set_order_status', { p_order_id: dupOrderId, p_new_status: 'ready' })).error;
check('admin: ready', !stErr, stErr?.message ?? '');
stErr = (await customer.rpc('set_order_status', { p_order_id: dupOrderId, p_new_status: 'out_for_delivery' })).error;
check('admin: out_for_delivery', !stErr, stErr?.message ?? '');

// agent onboarding via staff_grant_agent (Google-first flow: agent must exist first)
const agentSeed = await adminQuery(`select id from public.agent_users where email = 'agent@krishnavilas.in' limit 1`);
const agentId = agentSeed?.[0]?.id;
check('seeded agent exists for tests', !!agentId, 'agent@krishnavilas.in missing — re-run bootstrap-accounts.mjs');
await customer.rpc('assign_order', { p_order_id: dupOrderId, p_agent_id: agentId });
check('order assigned to agent', true);

const agentClient = createClient(URL, ANON);
const { error: agErr } = await agentClient.auth.signInWithPassword({
  email: 'agent@krishnavilas.in',
  password: 'kv-agent-temp-2026',
});
check('agent sign-in (API-level)', !agErr, agErr?.message ?? '');

// agent can read ONLY the assigned order, never another agent's
const { data: agOrder, error: agReadErr } = await agentClient.from('orders').select('*').eq('id', dupOrderId).single();
check('agent reads own assignment', agOrder?.agent_id === agentId && !agReadErr, agReadErr?.message ?? '');
const { data: otherOrder, error: otherErr } = await agentClient
  .from('orders')
  .select('*')
  .neq('id', dupOrderId);
check('agent cannot read unassigned orders', (otherOrder ?? []).length === 0 && !otherErr, String(otherOrder?.length));

let aErr2 = (await agentClient.rpc('agent_accept', { p_order_id: dupOrderId })).error;
check('agent accepted assignment', !aErr2, aErr2?.message ?? '');
aErr2 = (await agentClient.rpc('agent_pickup', { p_order_id: dupOrderId })).error;
check('agent picked up (out_for_delivery)', !aErr2, aErr2?.message ?? '');

// fetch the delivery PIN (agent CAN see it to verify delivery confirmation)
const { data: afterPick } = await agentClient.from('orders').select('delivery_pin').eq('id', dupOrderId).single();
check('delivery PIN issued on out_for_delivery', !!afterPick?.delivery_pin, afterPick?.delivery_pin);

// wrong PIN must fail
const { error: wrongPin } = await agentClient.rpc('agent_deliver', { p_order_id: dupOrderId, p_pin: '000000', p_collected: Number(agOrder.total) });
check('wrong delivery PIN rejected', !!wrongPin, wrongPin?.message ?? '');

await agentClient.rpc('agent_deliver', { p_order_id: dupOrderId, p_pin: afterPick.delivery_pin, p_collected: Number(agOrder.total) });
const { data: done } = await customer.from('orders').select('status, cod_collected, cod_expected').eq('id', dupOrderId).single();
check('delivered with COD recorded', done?.status === 'delivered' && Number(done.cod_collected) === Number(agOrder.total), JSON.stringify(done));

// agent cannot self-verify cash
const { error: selfVerify } = await agentClient.rpc('verify_cash', { p_order_id: dupOrderId });
check('agent cannot verify own cash handover', !!selfVerify, selfVerify?.message ?? '');

// agent handover → admin verifies
await agentClient.rpc('agent_hand_cash', { p_order_id: dupOrderId });
const { error: adminVerifyErr } = await customer.rpc('verify_cash', { p_order_id: dupOrderId });
check('admin verifies handover', !adminVerifyErr, adminVerifyErr?.message ?? '');

// a non-admin customer cannot transition their own order
const custOnly = createClient(URL, ANON);
const { error: custTransition2 } = await custOnly.rpc('set_order_status', { p_order_id: dupOrderId, p_new_status: 'confirmed' });
check('non-admin cannot change order status', !!custTransition2, custTransition2?.message ?? '');

// status history recorded
const { data: hist } = await customer.from('order_status_history').select('*').eq('order_id', dupOrderId).order('created_at');
check('status history trail exists', (hist ?? []).length >= 5, String(hist?.length));

// ---------------- cleanup: remove every e2e artefact ----------------
try {
  await adminQuery(`delete from public.admin_users where id = '${custUid}' or email = '${testEmail}';`);
  await adminQuery(`delete from public.agent_users where id = '${custUid}' and email = '${testEmail}';`);
  log('🧹 e2e admin grant removed');
} catch (e) {
  log('cleanup admin-row:', e.message);
}
try {
  await adminQuery(`delete from public.order_status_history where order_id in (select id from public.orders where customer_id = '${custUid}');
delete from public.order_items where order_id in (select id from public.orders where customer_id = '${custUid}');
delete from public.orders where customer_id = '${custUid}';`);
  await adminQuery(`delete from public.profiles where id = '${custUid}';`);
  await adminQuery(`delete from auth.identities where user_id = '${custUid}';`);
  await adminQuery(`delete from auth.users where id = '${custUid}';`);
  log('🧹 e2e customer + orders removed');
} catch (e) {
  log('cleanup customer:', e.message);
}

console.log(failures === 0 ? '\nALL E2E CHECKS PASSED' : `\n${failures} E2E CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
