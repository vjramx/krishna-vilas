# Krishna Vilas — Online Food Ordering

Production-oriented, mobile-first food ordering website for Krishna Vilas (South Indian hotel).
Customer site + Admin dashboard + Delivery-agent panel, backed by a single Supabase project.
Cash on Delivery only. Delivery only. English + Kannada.

## Stack

- Vite + React 18 + TypeScript (strict)
- Tailwind CSS (brand theme in `tailwind.config.js`)
- React Router 6, route-level code splitting
- Supabase JS v2 (Postgres + Auth + Storage + Realtime, RLS everywhere)
- Vitest + Testing Library (unit/integration), Playwright-core viewport sweep
- Zod (checkout form validation)

## Quick start

```bash
npm install
cp .env.example .env      # fill in the two Supabase values
npm run dev               # http://localhost:5173
```

Required env (see `.env.example`):

| Variable | Purpose |
| --- | --- |
| `VITE_SUPABASE_URL` | Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | anon/publishable key (safe for browsers; RLS-protected) |
| `VITE_PUBLIC_SITE_URL` | canonical site URL, used for OAuth redirect docs |

Never put a service-role or secret key into a `VITE_` variable — everything prefixed `VITE_` ships to the browser.

## Quality commands

```bash
npm run typecheck   # tsc --noEmit (strict)
npm test            # vitest run
npm run build       # production build -> dist/
npm run lint        # eslint src
```

Scripts in `scripts/`:

- `apply-migration.mjs <file>` — applies a SQL migration statement-by-statement via the Supabase Management API (requires `SB_TOKEN`)
- `grant-admin.mjs <email>` — grants the admin role to a Google account (needs `SB_TOKEN`)
- `bootstrap-accounts.mjs` — provisions test/demo accounts (needs `SB_TOKEN`)
- `e2e.mjs` — full end-to-end order-lifecycle test via a real GoTrue session (dual-issuer design; requires `SB_TOKEN`)
- `verify-firebase-rls.mjs` — verifies claim-based RLS and issuer pinning by emulating Firebase tokens at DB level (requires `SB_TOKEN`)
- `viewport-check.mjs` — Playwright sweep at 320/360/390/430/768/1024/1440 px (requires a running server)
- `app-ux-check.mjs` — Android app-feel checks on a 390×844 device profile: touch targets, tab-bar clearance, snackbar, hardware-back sheet dismissal, pull-to-refresh, Kannada layout (requires a running server)
- `make-app-icons.mjs` — regenerates `public/icon-{180,192,512,maskable-512}.png` from the brand mark

## Database

`supabase/migrations/0001_app_completeness.sql` adds:

- `order_status_history` table (+ RLS: participants and admins only) and an audit trigger writing status transitions
- `orders` + `menu_items` added to the `supabase_realtime` publication
- an admin-only onboarding RPC and a supporting index

`supabase/migrations/0002_google_staff.sql` (Google-only auth):

- `staff_grant_agent(email, name, phone)` — grants the delivery role to an existing Google-signed-in account
- `staff_grant_admin(email)` — grants the admin role the same way
- removes the password-based onboarding RPC and the seeded password-only admin

Below is the pre-existing schema this was built on: `profiles`, `admin_users`, `agent_users`, `categories`,
`menu_items`, `orders`, `order_items`, `special_offers`, `hotel_settings`, plus trusted RPCs
(`place_order`, `set_order_status`, `set_order_eta`, `assign_order`, `agent_accept/decline/arrived/pickup/deliver/fail/hand_cash`, `verify_cash`, PIN trigger).

Apply a new migration:

```bash
SB_TOKEN=<personal-access-token> node scripts/apply-migration.mjs supabase/migrations/000X_name.sql
```

## Roles and how users are onboarded

Everyone — customers, admins and delivery agents — signs in with **Google** (single password-free flow).

| Role | Sign in | Granted how |
| --- | --- | --- |
| Customer | "Continue with Google" | automatic on first Google sign-in |
| Admin | Google | `admin_users` row granted to the owner's Google email (already granted to `vijayramv229@gmail.com`; re-grant another admin with `scripts/grant-admin.mjs <email>`) |
| Agent | Google | Admin → Agents → "Add delivery agent" → RPC `staff_grant_agent(email, name, phone)` — the person must have signed in with Google **once** first |

A demo agent (`agent@krishnavilas.in`, password kept only for the API-level E2E test) exists; deactivate it in Admin → Agents once real agents are onboarded.

If `staff_grant_agent` returns “No signed-in account found for that email”, ask the new agent to visit the site once and tap *Continue with Google* — then add them.

## Google sign-in — via Firebase Auth (fully configured)

Sign-in is handled entirely by **Firebase Authentication** (`krishna-vilas` project) and connected
into Supabase through Supabase's **Third-Party Auth** integration:

- Client: Firebase JS SDK (`src/lib/firebase.ts`) → Google sign-in using a **redirect** flow
  (works in Android WebView, immune to popup blockers). No `getAnalytics` — keeps the bundle lean.
- Supabase client: created with `accessToken` — every Supabase query (and Realtime socket)
  carries the user's Firebase ID token.
- Supabase validates the token against Google's public JWKS; the integration was created via
  the Management API (`config/auth/third-party-auth`, issuer `https://securetoken.google.com/krishna-vilas`).
- DB security is **claim-based**: customers identified by the token `sub` (Firebase UID),
  staff by token `email`. Restrictive `issuer_pin` RLS policies bind access to exactly this
  Supabase project or the `krishna-vilas` Firebase project — tokens from *any other* Firebase
  project are rejected.
- Migration `supabase/migrations/0003_firebase_identity.sql` performs the schema/model switch
  (customer ids: `text` sub; staff tables keyed by email; all RPCs rewritten).

Owner-side items (one-time, in Firebase Console):
1. **Authentication → Sign-in method → Google → Enable** (unless already done).
2. **Authentication → Settings → Authorized domains**: `localhost` is already allowed; add your
   production domain when deployed.
3. *(Optional)* The Firebase token has no `role` claim, so Supabase queries run as the `anon`
   DB role — this app's RLS policies are deliberately written `to public` and validate identity
   from the claims themselves. Adding a `role: 'authenticated'` custom claim (needs Identity
   Platform or a Cloud Function) is possible later but not required for this app.

No Google OAuth Client ID/Secret is needed anywhere — Firebase handles the Google handshake.

## Storage

Menu images live in the public `food-images` bucket (jpg/png/webp, ≤ 5 MB), uploaded from
Admin → Menu → *Upload image*. Files are stored at `menu/<id>-<ts>.<ext>`.

## Realtime

- Customer: own order rows stream live status changes (My Orders / order detail)
- Admin: live order feed on dashboard/order list; COD page updates live
- Agent: assignment changes stream in

Channels are named, filtered, and removed on unmount; RLS filters what each role can receive.
Realtime does **not** wake a closed/backgrounded app (no push pipeline is configured).

## Deployment (free-tier friendly, e.g. Netlify)

```bash
npm run build           # outputs dist/
# Netlify: publish directory = dist, SPA redirect: /* → /index.html (200)
```

Add the same env vars in the host dashboard. Then update Supabase *URL Configuration* with the
production URL and add the production redirect URL.

**Not yet deployed** — no hosting account credentials were available in this environment.

## Android app shell (native behaviour already built in)

The UI is an **app, not a web page**: phone-width column (`480px` cap), 56 dp app bars, a Material
bottom tab bar with an active pill, 44 dp+ touch targets, no tap highlight, no text selection on
chrome, no rubber-band/pull-to-refresh from the browser, and safe-area padding on every edge.

| Behaviour | Where |
| --- | --- |
| Launch splash handed off to the app | `index.html` (`#boot-splash`) → removed in `src/main.tsx` after first paint |
| Material bottom sheet (handle, scroll body) | `Sheet` in `src/components/ui.tsx` |
| **Hardware back closes the sheet** instead of leaving the screen | `Sheet` pushes/pops a history entry |
| Snackbar with an action (e.g. *View cart*) | `showSnackbar` + `SnackbarHost` |
| Pull-to-refresh on the menu feed | `src/components/PullToRefresh.tsx` |
| Haptics on primary taps | `src/lib/haptics.ts` (`navigator.vibrate`) |
| Sticky action bars (cart, checkout) above the tab bar | `BottomActionBar` |
| Offline strip while the network is down | `src/components/OfflineBanner.tsx` |
| Scroll reset + task title + fade-through per screen | `src/components/AppChrome.tsx` |
| Hash routing when the bundle is loaded from `file://` (packaged shells) | `src/main.tsx` |
| Locked viewport (no pinch/double-tap zoom), keyboard resizes content | `index.html` viewport meta |

## Android WebView packaging

1. Host the site over HTTPS (free host per section above).
2. Create an empty Android app (any targetSdk ≥ 26) with a single `WebView` (`javaScriptEnabled = true`, `domStorageEnabled = true`, `mediaPlaybackRequiresUserGesture = false`).
3. Configure:
   - URL = your production URL
   - **Back button**: `webview.canGoBack()` → `webview.goBack()`
   - **External links / OAuth**: do NOT route Google OAuth inside the WebView. Intercept URLs outside your domain in `shouldOverrideUrlLoading` and open them with `Intent.ACTION_VIEW` (Custom Tabs). The sign-in redirect returns to the site URL and the app reloads the session automatically.
   - **File uploads** (menu admin image upload): implement `WebChromeClient.onShowFileChooser` with the provided file-chooser callback.
   - **Safe areas**: the site already consumes `env(safe-area-inset-*)`; make the activity fullscreen/edge-to-edge (`WindowCompat.setDecorFitsSystemWindows(window, false)`).
   - **Status bar**: the app paints `#C83E24` via `<meta name="theme-color">`; transparent status bar + light icons match the app bar.
   - **Splash**: show a native splash with the same brand mark (`public/icon-512.png`) so the hand-off is seamless, then let the in-app splash finish.
   - **Bundled assets** (optional): if you ship `dist/` inside the APK and load it with `file:///android_asset/index.html`, the app automatically switches to hash routing — no server rewrites needed.
   - Enable `WebView.setWebContentsDebuggingEnabled(false)` in release builds. Do not register any `@JavascriptInterface` unless strictly necessary and reviewed.
4. Optional notifications: Android system notifications for new orders need a push pipeline (e.g. FCM + edge function); not implemented.

## Known limits / free-tier notes

- Supabase free tier: ~500 MB DB, 1 GB storage, 2M edge-sync messages/month — comfortably fits one small restaurant; watch storage for photos.
- Email: default shared SMTP has a low rate limit; email confirmations are OFF (`mailer_autoconfirm = true`) because sign-in is OAuth-first. Configure custom SMTP if you later enable confirmation emails.
- Google OAuth needs the owner's own Google Cloud project credentials (free).
