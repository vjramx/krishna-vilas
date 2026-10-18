// One-time admin script: stamps `role: 'authenticated'` as a custom claim on
// every existing Firebase Authentication user.
//
// Why: Supabase's Data API maps the Postgres role from the JWT `role` claim.
// Firebase tokens have no such claim by default, so signed-in users would run
// as the anon Postgres role and hit "permission denied" on RLS-protected RPCs.
// See https://supabase.com/docs/guides/auth/third-party/firebase-auth
//
// Usage:
//   1. Firebase console → Project settings → Service accounts →
//      "Generate new private key" → save as `serviceAccountKey.json`
//      (anywhere outside this repository — never commit it).
//   2. node scripts/set-firebase-role-claims.mjs <path-to-serviceAccountKey.json>
//
// After running it, users must sign out and sign back in so a fresh ID token
// with the claim is issued (or any client action that force-refreshes the token).

'use strict';

import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);

const keyPath = process.argv[2];
if (!keyPath) {
  console.error('Usage: node scripts/set-firebase-role-claims.mjs <path-to-serviceAccountKey.json>');
  process.exit(1);
}

let serviceAccount;
try {
  // fs + require to avoid ESM import of a user-supplied JSON path.
  const fs = await import('node:fs');
  serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
} catch (e) {
  console.error(`Could not read service-account key at "${keyPath}": ${e.message}`);
  process.exit(1);
}

const { initializeApp, cert } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');

initializeApp({ credential: cert(serviceAccount) });

let nextPageToken;
let updated = 0;
let failed = 0;

do {
  const { users, pageToken } = await getAuth().listUsers(1000, nextPageToken);
  await Promise.all(
    users.map(async (u) => {
      try {
        const existing = u.customClaims ?? {};
        if (existing.role === 'authenticated') {
          updated += 1; // already correct
          return;
        }
        await getAuth().setCustomUserClaims(u.uid, { ...existing, role: 'authenticated' });
        updated += 1;
      } catch (e) {
        failed += 1;
        console.error(`Failed to set role claim for ${u.email ?? u.uid}: ${e.message}`);
      }
    }),
  );
  nextPageToken = pageToken;
} while (nextPageToken);

console.log(`Done. Users with role='authenticated' claim: ${updated}. Failures: ${failed}.`);
console.log('Users must sign out and sign back in so the new claim lands in their ID token.');
