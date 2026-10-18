import { readFileSync } from 'node:fs';

const REF = 'reodbsfxkorpgzimqijn';
const TOKEN = process.env.SB_TOKEN ?? '';
if (!TOKEN) throw new Error('SB_TOKEN env missing');

const env = Object.fromEntries(
  readFileSync('.env', 'utf8').split('\n').map((l) => l.trim().split('=')).filter((kv) => kv.length === 2),
);

const keys = await (await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
})).json();
const svc = Array.isArray(keys) ? keys.find((k) => k.id === 'service_role' || k.name === 'service_role')?.api_key : undefined;
if (!svc) throw new Error(`no service key in response: ${JSON.stringify(keys).slice(0, 200)}`);

const EMAIL = process.argv[2] ?? 'vijayramv229@gmail.com';

const res = await fetch(`${env.VITE_SUPABASE_URL}/auth/v1/admin/users`, {
  method: 'POST',
  headers: { apikey: svc, Authorization: `Bearer ${svc}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: EMAIL,
    email_confirm: true,
    user_metadata: { full_name: 'Vijay Ram — Krishna Vilas Admin' },
  }),
});
const body = await res.text();
if (!res.ok && !/already been registered/i.test(body)) throw new Error(body.slice(0, 300));
const uid = JSON.parse(body)?.id;
if (!uid) throw new Error(`no user id returned: ${body.slice(0, 200)}`);
console.log('auth user ready:', uid);

const sql = `
insert into public.admin_users (id, email) values ('${uid}', '${EMAIL}')
  on conflict (id) do update set email = excluded.email;
insert into public.profiles (id) values ('${uid}') on conflict (id) do nothing;
select (select count(*) from public.admin_users) admins,
       (select coalesce(bool_and(email = '${EMAIL}'), false) from public.admin_users) owner_is_admin;`;

const g = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
console.log('grant:', (await g.text()).slice(0, 300));
