import { readFileSync } from 'node:fs';

const TOKEN = process.env.SB_TOKEN ?? '';
const REF = 'reodbsfxkorpgzimqijn';

async function q(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json', Connection: 'close' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  return { status: res.status, body };
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

// 1) Owner Firebase-like token → admin
{
  const claims = JSON.stringify({
    iss: 'https://securetoken.google.com/krishna-vilas',
    aud: 'krishna-vilas',
    sub: 'firebaseUid_ownerFakeForPolicyTest',
    email: 'vijayramv229@gmail.com',
    email_verified: true,
  });
  const { body } = await q(`
    ${emulate(claims)}
    select
      (select public.is_allowed_issuer()) issuer_ok,
      (select public.is_current_admin()) admin_ok,
      (select public.is_current_agent()) agent_ok,
      (select public.kv_subject()) subj_kind_check,
      (select count(*) from public.menu_items) menu_rows;`);
  const r = JSON.parse(body)[0] ?? {};
  check('firebase token accepted (issuer pin)', r.issuer_ok === true, body.slice(0, 200));
  check('owner admin via email claim', r.admin_ok === true, JSON.stringify(r));
  check('owner not agent', r.agent_ok === false);
  check('admin can read menu (anon role + RLS)', Number(r.menu_rows) === 14, String(r.menu_rows));
}

// 2) Randomer Firebase project token → rejected
{
  const claims = JSON.stringify({
    iss: 'https://securetoken.google.com/someone-elses-project',
    aud: 'someone-elses-project',
    sub: 'evilUid',
    email: 'attacker@evil.test',
  });
  const { body } = await q(`
    ${emulate(claims)}
    select
      (select public.is_allowed_issuer()) issuer_ok,
      (select count(*) from public.menu_items) menu_rows,
      (select count(*) from public.orders) orders_rows;`);
  const r = JSON.parse(body)[0] ?? {};
  check('foreign firebase project rejected', r.issuer_ok === false && Number(r.menu_rows) === 0 && Number(r.orders_rows) === 0, JSON.stringify(r));
}

// 3) Agent token → agent role + only assigned orders
{
  const claims = JSON.stringify({
    iss: 'https://securetoken.google.com/krishna-vilas',
    aud: 'krishna-vilas',
    sub: 'firebaseUid_agentFake',
    email: 'agent@krishnavilas.in',
    email_verified: true,
  });
  const agentRow = await q(`select id from public.agent_users where email = 'agent@krishnavilas.in' limit 1;`);
  const agentId = JSON.parse(agentRow.body)[0]?.id;
  const { body } = await q(`
    select set_config('role', 'anon', true);
    select set_config('request.jwt.claims', '${claims}', false);
    select
      (select public.is_current_agent()) agent_ok,
      (select public.kv_agent_id()::text = '${agentId}') agent_maps,
      (select count(*) from public.orders) visible_orders;`);
  const r = JSON.parse(body)[0] ?? {};
  check('agent recognised via email claim', r.agent_ok === true, JSON.stringify(r));
  check('agent maps to its agent_users row', r.agent_maps === true);
  check('agent sees zero orders before assignment', Number(r.visible_orders) === 0, String(r.visible_orders));
}

// 4) No claims → everything locked
{
  const { body } = await q(`
    select set_config('role', 'anon', true);
    select set_config('request.jwt.claims', '', false);
    select
      (select public.is_allowed_issuer()) issuer_ok,
      (select public.is_current_admin()) admin_ok,
      (select count(*) from public.orders) orders_rows;`);
  const r = JSON.parse(body)[0] ?? {};
  check('tokenless request locked out', r.issuer_ok === false && r.admin_ok === false && Number(r.orders_rows) === 0, JSON.stringify(r));
}

// 5) customer own-order isolation: place order as emulated Firebase subject
{
  const claims = JSON.stringify({
    iss: 'https://securetoken.google.com/krishna-vilas',
    aud: 'krishna-vilas',
    sub: 'firebaseUid_e2e_customer',
    email: 'cust@test.dev',
    email_verified: true,
  });
  const item = await q(`select id, price, is_active, is_available from public.menu_items where is_active limit 1;`);
  const it = JSON.parse(item.body)[0];
  const placeRes = await q(`
    select set_config('role', 'anon', true);
    select set_config('request.jwt.claims', '${claims}', false);
    select public.place_order(
      jsonb_build_array(jsonb_build_object('item_id', '${it.id}', 'quantity', 2)),
      'FB Cust', '9876543210', 'Firebase Road 42', 'Test Area',
      null, null, '${crypto.randomUUID()}');`);
  const findOrder = (v) => {
    if (Array.isArray(v)) { for (const x of v) { const f = findOrder(x); if (f) return f; } return null; }
    if (v && typeof v === 'object') {
      if ('order_id' in v) return v;
      for (const x of Object.values(v)) { const f = findOrder(x); if (f) return f; }
    }
    return null;
  };
  let placed;
  try {
    placed = findOrder(JSON.parse(placeRes.body)) ?? { error: placeRes.body.slice(0, 300) };
  } catch {
    placed = { error: placeRes.body.slice(0, 300) };
  }
  check('place_order works for firebase-identity customer', !!placed?.order_id, JSON.stringify(placed));
  const { body: iso } = await q(`
    select set_config('role', 'anon', true);
    select set_config('request.jwt.claims', '${claims}', false);
    select count(*) as own, (select count(*) from public.orders) total from public.orders;`);
  const r = JSON.parse(iso).at(-1) ?? {};
  check('customer sees only own order (foreign orders hidden)', Number(r.own) === 1 && Number(r.total) === 1, JSON.stringify(r));
  // cleanup
  await q(`delete from public.order_status_history where order_id in (select id from public.orders where customer_id = 'firebaseUid_e2e_customer');
delete from public.order_items where order_id in (select id from public.orders where customer_id = 'firebaseUid_e2e_customer');
delete from public.orders where customer_id = 'firebaseUid_e2e_customer';
delete from public.profiles where id = 'firebaseUid_e2e_customer';`);
}

console.log(failures === 0 ? '\nRLS/IDENTITY VERIFICATION PASSED' : `\n${failures} CHECKS FAILED`);
process.exit(failures === 0 ? 0 : 1);
