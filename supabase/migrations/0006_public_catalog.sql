-- 0006_public_catalog: the public menu must be readable by signed-out visitors.
--
-- Migration 0003 attached a blanket RESTRICTIVE `issuer_pin` SELECT policy to
-- every public table. Restrictive policies AND with the permissive ones, so a
-- caller without a token from an allowed issuer (i.e. any anonymous shopper)
-- matched zero rows: the menu rendered empty, `hotel_settings` returned no row
-- (supabase `.maybeSingle()` then surfaces HTTP 406), and the storefront lost
-- its name/timings/banner.
--
-- Catalog tables are public data (they feed the storefront before sign-in).
-- Their permissive policies still guard writes via `is_administrator()`, and
-- menu/category reads still filter on `is_active`.
--
-- Kept restricted (do NOT drop these): orders, order_items,
-- order_status_history — those carry customer PII and require a verified
-- Firebase token from the krishna-vilas project.

drop policy if exists issuer_pin on public.menu_items;
drop policy if exists issuer_pin on public.categories;
drop policy if exists issuer_pin on public.hotel_settings;
drop policy if exists issuer_pin on public.special_offers;
