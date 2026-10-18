import { readFileSync, writeFileSync, appendFileSync, existsSync, unlinkSync } from 'node:fs';

const REF = 'reodbsfxkorpgzimqijn';
const MGMT = `https://api.supabase.com/v1/projects/${REF}`;
const TOKEN = process.env.SB_TOKEN ?? '';
const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').map((l) => l.trim().split('=')).filter((kv) => kv.length === 2),
);

// Fetch the legacy service_role JWT once via the management API (server-side only).
const keys = await (await fetch(`${MGMT}/api-keys`, { headers: { Authorization: `Bearer ${TOKEN}` } })).json();
const serviceKey = keys.find((k) => k.id === 'service_role' || k.name === 'service_role')?.api_key;
if (!serviceKey) throw new Error('no service key');

const AUTH = env.VITE_SUPABASE_URL + '/auth/v1';

async function upsertAuthUser(email, password, fullName) {
  const res = await fetch(`${AUTH}/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    }),
  });
  const body = await res.text();
  if (!res.ok && !/already been registered/i.test(body)) throw new Error(`${email}: ${res.status} ${body.slice(0, 200)}`);
  const parsed = JSON.parse(body);
  return parsed.id;
}

const accounts = [
  ['admin@krishnavilas.in', 'kv-admin-temp-2026', 'Restaurant Admin'],
  ['agent@krishnavilas.in', 'kv-agent-temp-2026', 'Demo Agent'],
];

const ids = {};
for (const [email, password, name] of accounts) {
  ids[email] = await upsertAuthUser(email, password, name);
  console.log('auth user ok:', email, ids[email]);
}

// Clean up earlier hand-inserted rows that may collide, then grant roles via SQL.
// Optional (only needed once after the first hand-insert attempt):
const skipCleanup = process.argv.includes('--no-cleanup');
const deleteOld = `
delete from auth.identities where user_id in (select id from auth.users where lower(email) in ('admin@krishnavilas.in','agent@krishnavilas.in'));
delete from public.order_status_history where changed_by in (select id from auth.users where lower(email) in ('admin@krishnavilas.in','agent@krishnavilas.in'));
delete from public.agent_users where id in (select id from auth.users where lower(email) in ('admin@krishnavilas.in','agent@krishnavilas.in'));
delete from public.admin_users where id in (select id from auth.users where lower(email) in ('admin@krishnavilas.in','agent@krishnavilas.in'));
delete from public.profiles where id in (select id from auth.users where lower(email) in ('admin@krishnavilas.in','agent@krishnavilas.in'));
delete from auth.users where lower(email) in ('admin@krishnavilas.in','agent@krishnavilas.in');
`;
const delRes = skipCleanup
  ? { status: 'skipped', text: async () => '' }
  : await fetch(`${MGMT}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: deleteOld }),
    });
console.log('cleanup:', delRes.status, (await delRes.text()).slice(0, 200));

// Grant roles to the fresh GoTrue-created users.
const ui = ids['admin@krishnavilas.in'];
const gi = ids['agent@krishnavilas.in'];
const grant = `
insert into public.admin_users (id, email) values ('${ui}', 'admin@krishnavilas.in') on conflict (id) do update set email = excluded.email;
insert into public.agent_users (id, email, name_en, phone, is_active) values ('${gi}', 'agent@krishnavilas.in', 'Demo Agent', null, true) on conflict (id) do update set is_active = true;
insert into public.profiles (id) values ('${ui}'), ('${gi}') on conflict (id) do nothing;
select (select count(*) from public.admin_users) a, (select count(*) from public.agent_users) g;
`;
const grantRes = await fetch(`${MGMT}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: grant }),
});
console.log('grant:', grantRes.status, (await grantRes.text()).slice(0, 300));
