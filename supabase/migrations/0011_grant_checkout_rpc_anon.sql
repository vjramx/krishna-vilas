-- 0011_grant_checkout_rpc_anon: customers sign in with Firebase (third-party
-- auth), whose ID tokens carry no `role` claim, so every Data API call —
-- signed in or not — runs as the `anon` Postgres role. Migration 0007 granted
-- place_order_with_location to `authenticated` only, making the function
-- invisible to customers and producing an HTTP 401 when tapping Place Order.
--
-- Fix mirrors the grant pattern of the base place_order RPC: execute for
-- `anon, authenticated`. This is safe because the function is SECURITY
-- DEFINER and its own explicit AUTH_REQUIRED check (place_order -> kv_subject)
-- rejects unauthenticated callers before any data is touched.

revoke all on function public.place_order_with_location(jsonb, text, text, text, text, text, text, uuid, numeric, numeric, numeric, text, timestamptz, jsonb) from public;
grant execute on function public.place_order_with_location(jsonb, text, text, text, text, text, text, uuid, numeric, numeric, numeric, text, timestamptz, jsonb) to anon, authenticated;
