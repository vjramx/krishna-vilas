// delete-account: server-side account deletion for Krishna Vilas Food Delivery.
//
// Security model (matches docs/DELETION.md):
//   1. The caller presents their OWN fresh Firebase ID token (recent Google
//      reauthentication is enforced client-side; this function additionally
//      rejects tokens minted more than 10 minutes before the request).
//   2. The token is verified with Google's public JWKS — signature, issuer,
//      audience, expiry and email_verified. The uid/email ALWAYS come from
//      the verified token; request bodies are never trusted for identity.
//   3. Personal data purge runs through the service-role connection into
//      public.kv_delete_account_data (server-only grant; staff accounts and
//      pending-order accounts are refused server-side with clear codes).
//   4. The Firebase authentication account is deleted at Identity Toolkit
//      ("accounts:delete" authenticated by the same verified token — the
//      documented end-user self-deletion path; this deletes THIS app's own
//      account record only, never the customer's Google Account).
//   5. The purge RPC is idempotent; a retry after a lost response between
//      steps 3 and 4 completes safely (step 3 becomes a no-op).
//
// Minimal logging: only coarse error codes and a uid prefix are logged, never
// tokens, emails or other personal data.
import { createRemoteJWKSet, jwtVerify } from 'https://esm.sh/jose@5.9.6';

const FIREBASE_PROJECT_ID = Deno.env.get('FIREBASE_PROJECT_ID') ?? 'krishna-vilas';
// Firebase web API keys are public by design (they ship in every Firebase web
// app); they authorize the project's Identity Toolkit endpoint, which this
// function calls to delete the caller's own auth account.
const FIREBASE_WEB_API_KEY = Deno.env.get('FIREBASE_WEB_API_KEY') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? Deno.env.get('VITE_SUPABASE_URL') ?? '';
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
);
const MAX_TOKEN_AGE_SECONDS = 600; // fresh-login requirement (matches UI reauth)
const CORS_METHODS = 'POST, OPTIONS';
const CORS_HEADERS = 'Authorization, Content-Type, apikey';

function json(status: number, body: object, origin: string | null): Response {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (origin) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Access-Control-Allow-Methods'] = CORS_METHODS;
    headers['Access-Control-Allow-Headers'] = CORS_HEADERS;
  }
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (req) => {
  const origin = req.headers.get('origin');
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      status: 204,
      headers: origin
        ? {
            'Access-Control-Allow-Origin': origin,
            'Access-Control-Allow-Methods': CORS_METHODS,
            'Access-Control-Allow-Headers': CORS_HEADERS,
          }
        : {},
    });
  }
  if (req.method !== 'POST') return json(405, { error: 'METHOD_NOT_ALLOWED' }, origin);

  // ---------------- 1) verify the caller's Firebase ID token -------------------
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!bearer) return json(401, { error: 'UNAUTHORIZED', detail: 'token missing' }, origin);

  let uid = '';
  let email = '';
  let authTime = 0;
  let emailVerified = false;
  try {
    const { payload } = await jwtVerify(bearer, JWKS, {
      issuer: `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`,
      audience: FIREBASE_PROJECT_ID,
    });
    uid = String((payload as { sub?: unknown }).sub ?? '');
    email = String((payload as { email?: unknown }).email ?? '').toLowerCase();
    authTime = Number((payload as { auth_time?: unknown }).auth_time ?? 0);
    emailVerified = (payload as { email_verified?: unknown }).email_verified === true;
  } catch (e) {
    console.error(`[delete-account] token verify failed: ${String((e as Error)?.message ?? e).slice(0, 120)}`);
    return json(401, { error: 'UNAUTHORIZED', detail: 'invalid token' }, origin);
  }
  if (!uid || !email) return json(401, { error: 'UNAUTHORIZED', detail: 'claims missing' }, origin);
  if (!emailVerified) {
    return json(403, { error: 'EMAIL_NOT_VERIFIED' }, origin);
  }

  // ---------------- 2) recent-login enforcement --------------------------------
  const ageSeconds = Math.floor(Date.now() / 1000) - Math.max(0, Math.floor(authTime));
  if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_TOKEN_AGE_SECONDS) {
    return json(401, { error: 'REAUTH_REQUIRED' }, origin);
  }

  // ---------------- 3) purge personal data (service role) ----------------------
  const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/kv_delete_account_data`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_uid: uid, p_email: email }),
  });
  const rpcText = await rpcRes.text();
  if (!rpcRes.ok) {
    // Any refusal of the server-side gates (staff / pending orders / invalid uid)
    // is a semantic failure; transactionality keeps the data untouched.
    let detail = rpcText.slice(0, 200);
    let code = 'PURGE_FAILED';
    if (detail.includes('STAFF_ACCOUNT')) code = 'STAFF_ACCOUNT';
    else if (detail.includes('PENDING_ORDERS')) {
      code = 'PENDING_ORDERS';
      const m = /PENDING_ORDERS \[(\d+)\]/.exec(detail);
      if (m) detail = m[1];
    } else if (detail.includes('SERVER_ONLY') || detail.includes('EMAIL_REQUIRED') || detail.includes('INVALID_UID')) {
      code = 'UNAUTHORIZED';
    }
    console.error(`[delete-account] purge rejected uid=${uid.slice(0, 4)}… code=${code}`);
    return json(code === 'PENDING_ORDERS' ? 409 : 500, { error: code, detail }, origin);
  }
  console.log(`[delete-account] purge ok uid=${uid.slice(0, 4)}…`);

  // ---------------- 4) delete the auth account (self-deletion path) ------------
  if (FIREBASE_WEB_API_KEY) {
    const delRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${FIREBASE_WEB_API_KEY}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: bearer }),
    });
    if (!delRes.ok) {
      const delText = await delRes.text();
      // USER_NOT_FOUND means the account is already gone (safe retry path).
      if (/USER_NOT_FOUND|INVALID_ID_TOKEN/i.test(delText) && /already|user.?not.?found/i.test(delText)) {
        return json(200, { ok: true, note: '_already_deleted' }, origin);
      }
      // Personal data is already gone; the account itself still exists. The
      // customer can simply retry (purge is a no-op now) — report precisely.
      console.error(`[delete-account] firebase delete failed uid=${uid.slice(0, 4)}… ${delRes.status}`);
      return json(502, { error: 'AUTH_DELETE_PENDING', detail: delText.slice(0, 200) }, origin);
    }
  } else {
    // Configuration is incomplete: refuse to promise deletion of the auth
    // account. The data purge has still happened (transaction 3).
    console.error('[delete-account] FIREBASE_WEB_API_KEY not configured');
    return json(503, { error: 'CONFIG_MISSING', detail: 'FIREBASE_WEB_API_KEY' }, origin);
  }

  return json(200, { ok: true }, origin);
});
