// Deploy supabase/functions/delete-account → the live project via the
// Management API, and upsert the FIREBASE_WEB_API_KEY function secret.
// Prints only statuses/slug names — never reads, echoes or writes any secret
// value to stdout. Usage: node --env-file=.env scripts/deploy-delete-account.mjs
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split('\n')
    .map((line) => line.trim().split('='))
    .filter((kv) => kv.length === 2),
);
const TOKEN = env.SB_TOKEN ?? process.env.SB_TOKEN ?? '';
const REF = 'reodbsfxkorpgzimqijn';
// The Firebase web API key is public by design (shipped in src/lib/firebase.ts).
// It identifies the project on Identity Toolkit; it is NOT a secret.
let WEB_API_KEY = env.VITE_FIREBASE_API_KEY ?? '';
if (!WEB_API_KEY) {
  const m = /apiKey:\s*'([^']+)'/.exec(readFileSync('src/lib/firebase.ts', 'utf8'));
  if (m) WEB_API_KEY = m[1];
}

const slug = 'delete-account';
const source = readFileSync(`supabase/functions/${slug}/index.ts`, 'utf8');

// ---- 1) secret upsert (values never printed) ---------------------------------
if (WEB_API_KEY) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/secrets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify([{ name: 'FIREBASE_WEB_API_KEY', value: WEB_API_KEY }]),
  });
  const text = await res.text();
  console.log(`secret upsert http ${res.status} ${/error/i.test(text) ? text.slice(0, 300) : '(ok)'}`);
  if (!res.ok && res.status !== 405 && res.status !== 404) {
    console.error('Secret upsert failed — stopping so a deploy never ships an unconfigured function.');
    process.exit(1);
  }
  if (!res.ok) {
    console.error('Secret upsert failed; continuing to deploy only for diagnostics.');
  }
} else {
  console.log('no VITE_FIREBASE_API_KEY in .env — deploying without the secret (function will answer CONFIG_MISSING; safe)');
}

// ---- 2) function deploy (multipart, server-side bundling) ---------------------
const form = new FormData();
form.append('metadata', JSON.stringify({
  name: slug,
  entrypoint_path: 'index.ts',
  verify_jwt: false, // Firebase token is verified inside the function via JWKS
}));
form.append('file', new Blob([source], { type: 'text/plain' }), 'index.ts');

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/functions/deploy?slug=${slug}`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}` },
  body: form,
});
const body = await res.text();
console.log(`deploy http ${res.status}: ${body.slice(0, 500)}`);
process.exit(res.ok ? 0 : 1);
