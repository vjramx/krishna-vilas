// Read-only verification of the Firebase -> Supabase auth configuration.
//
// Usage:
//   SB_TOKEN=sbp_... node scripts/verify-auth-config.mjs
//
// Checks the invariants that must hold for Firebase ID tokens to be accepted
// by the Supabase Data API (these were the exact root cause of PGRST301
// "No suitable key or wrong key type"):
//
//   1. A third-party auth integration exists with issuer
//      https://securetoken.google.com/<firebase-project>, and it has resolved
//      Firebase signing keys.
//   2. The live PostgREST verifier actually consults the Firebase JWKS (proved
//      behaviorally). An explicit `jwt_secret` override silently forces
//      verification against that one symmetric secret instead.
//   3. public.admin_users contains the bootstrapped super admin.
//
// Never prints secrets.

import { readFileSync } from 'node:fs';
import { createSign, generateKeyPairSync } from 'node:crypto';
import process from 'node:process';

const REF = process.env.SB_REF ?? 'reodbsfxkorpgzimqijn';
const FIREBASE_PROJECT = process.env.FIREBASE_PROJECT ?? 'krishna-vilas';
const OWNER_EMAIL = process.env.OWNER_EMAIL ?? 'vijayramv229@gmail.com';
const TOKEN = process.env.SB_TOKEN ?? '';
const API = `https://api.supabase.com/v1/projects/${REF}`;

if (!TOKEN) {
  console.error('SB_TOKEN env missing (Supabase personal access token).');
  process.exit(1);
}

/** Read public Supabase connection values from the local .env (never printed). */
function localEnv() {
  try {
    return Object.fromEntries(
      readFileSync('.env', 'utf8')
        .split('\n')
        .map((l) => l.trim().split('='))
        .filter((kv) => kv.length === 2),
    );
  } catch {
    return {};
  }
}

const env = localEnv();

/** Mint a Firebase-shaped, self-signed RS256 token (wrong signature by design). */
function probeToken(kid) {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const b64u = (s) => Buffer.from(s).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = b64u(
    JSON.stringify({
      iss: `https://securetoken.google.com/${FIREBASE_PROJECT}`,
      aud: FIREBASE_PROJECT,
      sub: 'config-check',
      email: OWNER_EMAIL,
      email_verified: true,
      role: 'authenticated',
      iat: now,
      exp: now + 300,
    }),
  );
  const input = `${head}.${body}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(privateKey).toString('base64url')}`;
}

/** Live behavioral probe: does the verifier consult the registered JWKS? */
async function probeVerifier(kid) {
  const url = env.VITE_SUPABASE_URL;
  const anon = env.VITE_SUPABASE_ANON_KEY;
  if (!url || !anon) return { skipped: true };
  const res = await fetch(`${url}/rest/v1/rpc/is_current_admin`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${probeToken(kid)}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, details: body.details ?? '', message: body.message ?? '' };
}

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
const failures = [];
const ok = (msg) => console.log(`  ok   ${msg}`);
const bad = (msg) => {
  failures.push(msg);
  console.log(`  FAIL ${msg}`);
};

async function main() {
  console.log(`Project: ${REF}  Firebase project: ${FIREBASE_PROJECT}`);

  // 1) Third-party auth integration
  console.log('\n[1] Third-party auth integration');
  const tpa = await (await fetch(`${API}/config/auth/third-party-auth`, { headers })).json();
  const list = Array.isArray(tpa) ? tpa : [];
  const wantIssuer = `https://securetoken.google.com/${FIREBASE_PROJECT}`;
  const match = list.find((i) => (i.oidc_issuer_url ?? '').replace(/\/$/, '') === wantIssuer);
  if (!match) {
    bad(`no integration with issuer ${wantIssuer} (found: ${list.map((i) => i.oidc_issuer_url).join(', ') || 'none'})`);
  } else {
    ok(`integration ${match.id} (type=${match.type})`);
    const keys = match.resolved_jwks?.keys?.length ?? 0;
    if (keys > 0) ok(`${keys} Firebase signing keys resolved (resolved_at=${match.resolved_at ?? '—'})`);
    else bad('integration has no resolved signing keys');
  }

  // 2) Live behavioral check: a token whose kid IS in the JWKS must reach the
  //    signature-verification stage, while an unknown kid must not find a key.
  //    Identical errors for both = the JWKS is being ignored (the PGRST301 bug).
  console.log('\n[2] PostgREST JWT verification (live probe)');
  const knownKid = match?.resolved_jwks?.keys?.[0]?.kid;
  if (!knownKid) {
    bad('cannot probe: integration has no resolved key id');
  } else {
    const [known, unknown] = await Promise.all([probeVerifier(knownKid), probeVerifier('config-check-unknown-kid')]);
    if (known.skipped) {
      bad('cannot probe: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env');
    } else {
      const reachedKeyset = known.details.includes('None of the keys') && known.details !== unknown.details;
      if (reachedKeyset) {
        ok('verifier consults the Firebase JWKS (known kid → signature check, unknown kid → no key)');
        ok('no jwt_secret override is suppressing third-party verification');
      } else {
        bad('JWKS is ignored — a PostgREST `jwt_secret` override is likely set' +
          ` (known: "${known.details}", unknown: "${unknown.details}")`);
      }
    }
  }

  // 3) Super-admin bootstrap row
  console.log('\n[3] Super-admin bootstrap');
  const rows = await (
    await fetch(`${API}/database/query`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        query: `select email, role from public.admin_users where lower(email) = lower('${OWNER_EMAIL}');`,
      }),
    })
  ).json();
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) bad(`no admin_users row for ${OWNER_EMAIL}`);
  else if (row.role === 'super_admin') ok(`${row.email} = ${row.role}`);
  else bad(`${row.email} has role ${row.role} (expected super_admin)`);

  console.log('');
  if (failures.length) {
    console.error(`FAILED ${failures.length} check(s).`);
    process.exit(1);
  }
  console.log('All checks passed — Firebase tokens will verify and route to admin.');
}

await main();
