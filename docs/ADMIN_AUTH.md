# Admin & staff authentication (Firebase → Supabase)

## Model

- **Identity**: Firebase Authentication (Google sign-in) is the only identity provider.
- **Data**: Supabase Postgres, authorized from the Firebase ID token.
- **Token flow**: `src/lib/supabase.ts` passes `accessToken: () => firebaseUser.getIdToken()`
  on every Supabase request. The token is an **RS256 JWT signed by Google**.
- **Verification**: Supabase's Data API (PostgREST) verifies that token against the
  Firebase **JWKS** registered by the project's Third-Party Auth integration.
- **Roles**: SQL helpers read the verified JWT claims
  (`supabase/migrations/0003_firebase_identity.sql`):
  - `kv_email()` — lowercase `email` claim
  - `is_allowed_issuer()` — `iss = https://securetoken.google.com/krishna-vilas`, `aud = krishna-vilas`
  - `is_administrator()` — `admin_users` row matching `kv_email()`
  - `is_current_admin()` (0004) — auto-accepts a matching pending invitation, then `is_administrator()`
- **Frontend gate**: `src/context/AuthContext.tsx` resolves `role` from those RPCs and
  `src/pages/admin/AdminLayout.tsx` guards `/admin`. UI gating never grants access; RLS does.

## Hard invariant (this was the PGRST301 bug)

**The project's PostgREST configuration must NOT set an explicit `jwt_secret`.**

If it does, PostgREST verifies every JWT against that one symmetric secret and
**silently ignores the third-party JWKS**, so every Firebase token fails with:

```
PGRST301: "No suitable key or wrong key type"
[dbg] role error: ...
```

Check: `SB_TOKEN=... node scripts/verify-auth-config.mjs`
Clear (management API): `PATCH /v1/projects/{ref}/postgrest {"jwt_secret": null}`

The registered integration itself:

```
GET /v1/projects/{ref}/config/auth/third-party-auth
=> [{ type: "firebase",
      oidc_issuer_url: "https://securetoken.google.com/krishna-vilas",
      jwks_url: "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com",
      resolved_jwks: { keys: [...] } }]
```

When creating it via the API, **always pass `jwks_url` explicitly** — an integration
created without one resolves keys once but can leave the data plane without a URL.

## Bootstrap (initial super admin)

`supabase/migrations/0004_admin_access.sql` inserts `vijayramv229@gmail.com` as
`super_admin` idempotently (server-side migration only; no client can grant this).
Verified live: `select email, role from public.admin_users;`
→ `vijayramv229@gmail.com | super_admin`.

## Custom claim note

Supabase maps the Postgres role from the JWT `role` claim; Firebase tokens don't
carry one, so requests run as the `anon` Postgres role. This project's RLS policies
are claim-based and granted `to public` (`is_allowed_issuer()` / `is_administrator()`
/ `kv_subject()`), so functionality does not depend on that claim. If policies are
ever tightened `to authenticated`, run
`node scripts/set-firebase-role-claims.mjs <serviceAccountKey.json>` first.

## Operations log

- 2026-10-17: root cause found — PostgREST `jwt_secret` override suppressed Firebase
  JWKS. Cleared; verifier switched from "No suitable key" to signature-checking
  against the resolved Firebase keys (probe-verified).
- 2026-10-17: third-party integration recreated with an explicit `jwks_url`.
