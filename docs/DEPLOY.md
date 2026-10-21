# Deploying Krishna Vilas to the web

The app is a static Vite build (`dist/`). Any static host works; Vercel is the
recommended free option below. Deployment is deferred — the owner chose to
deploy later; these steps are ready to follow.

## One-time Supabase setup (already done once, re-check after any redeploy)

- Migration `0007_delivery_location.sql` was applied to the project via
  `node scripts/apply-migration.mjs supabase/migrations/0007_delivery_location.sql`
  (needs `SB_TOKEN` in `.env`). When new SQL files are added under
  `supabase/migrations/`, apply them the same way before customers hit features
  that rely on them.
- After deploying to a new domain, open Supabase → Authentication → URL
  Configuration and add the new domain to the redirect allow-list, otherwise
  Google sign-in fails with `auth/unauthorized-domain`.

## Deploy with Vercel (free)

1. `vercel.json` in the repo root already configures SPA routing
   (all paths rewrite to `index.html`). Keep it when deploying.
2. Create an account at vercel.com, then **Add New → Project** and import this
   repository (or use `npx vercel` from the project folder and follow prompts).
3. Build settings: build command `npm run build`, output directory `dist`.
4. Project → Settings → Environment Variables, add:
   - `VITE_SUPABASE_URL` (from local `.env`)
   - `VITE_SUPABASE_ANON_KEY` (from local `.env`)
   - `VITE_PUBLIC_SITE_URL` (the final deployed URL, no trailing slash)
   Only `VITE_`-prefixed values are safe for the client. Never add `SB_TOKEN`
   (or any service/admin key) to Vercel — it is a local management credential.
5. Deploy, then update `VITE_PUBLIC_SITE_URL` if the final domain differs and
   redeploy so OAuth redirect calculations use the right origin.
6. Optional: add a custom domain under Project → Domains and follow the DNS
   instructions; remember to allow-list the custom domain in Supabase too.

## Deploy with Netlify (alternative)

1. Connect the repo, or drag-and-drop the `dist/` folder at app.netlify.com.
2. Build command `npm run build`, publish directory `dist`.
3. Add the same three `VITE_` environment variables in Site settings.
4. SPA fallback is automatic for Vite apps on Netlify ("_redirects" not required
   for their default single-page detection); verify deep links like `/cart`
   work after deploy.

## Post-deploy verification checklist

- `node .tmp/probe-checkout.mjs` (local, read-only) — confirms catalog,
  settings, offers and RPC reachability against the live project.
- Open the deployed site in a phone browser: menu loads, item can be added,
  Google sign-in works, cart → checkout → place order → order detail screen.
- Confirm one real order appears in the admin orders dashboard.
