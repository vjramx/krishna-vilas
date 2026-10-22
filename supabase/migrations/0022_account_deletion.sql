-- 0022_account_deletion: Google-Play/privacy-compliant customer account deletion.
--
-- The data purge runs server-side only. The `delete-account` Edge Function
-- verifies a freshly minted Firebase ID token (signature + issuer/audience pin
-- + email_verified + recent auth_time), then calls this function THROUGH the
-- service-role role, so end users can never reach the purge over PostgREST.
--
-- Design notes:
--   * Staff accounts (admin/agent users) are identified by email and are NEVER
--     deletable through this endpoint.
--   * A customer with an active order must resolve it (deliver/cancel) before
--     deletion; the pending orders count is returned so the UI can explain.
--   * Order history rows are retained but fully anonymized: the business keeps
--     financial/logistics records (accounting, fraud, dispute resolution)
--     without personal data. Delete on those orders would also break the
--     audit trail; anonymization of delivery PINs and contact fields is the
--     compliant approach.
--   * The whole purge is one transaction — any failure rolls everything back.
--   * Re-running after a partial failure is safe: already-purged data is
--     skipped and the call stays idempotent (profile_deleted=false).
create or replace function public.kv_delete_account_data(
  p_uid text,
  p_email text default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_email text := lower(coalesce(btrim(nullif(p_email, '')), ''));
  v_active_orders int := 0;
  v_orders_anonymized int := 0;
  v_activity_deleted int := 0;
  v_profile_deleted boolean := false;
begin
  -- ---------------- server-only guard -------------------------------------
  -- Revoke/grant at the end limits callers to service_role; this is a second
  -- lock in case the privileges are someday reset by a platform migration.
  if current_user not in ('service_role', 'postgres', 'supabase_admin') then
    raise exception 'SERVER_ONLY';
  end if;

  if p_uid is null
     or length(btrim(p_uid)) < 1
     or length(btrim(p_uid)) > 128
     or btrim(p_uid) ~ '[[:cntrl:]]' then
    raise exception 'INVALID_UID';
  end if;
  p_uid := btrim(p_uid);

  -- ---------------- staff defense in depth ---------------------------------
  -- Identity mapping in this project is email-based (0003_firebase_identity).
  -- The Edge Function passes the email from the *verified* token; never a
  -- client-nominated value is trusted because it comes with a signed token.
  if v_email = '' then
    raise exception 'EMAIL_REQUIRED';
  end if;
  if exists (select 1 from public.admin_users a where lower(a.email) = v_email)
     or exists (select 1 from public.agent_users a where lower(a.email) = v_email) then
    raise exception 'STAFF_ACCOUNT';
  end if;

  -- ---------------- pending orders block ------------------------------------
  -- A deletion while food is in flight breaks COD settlement and disputes.
  -- The customer resolves the order first; count explains the UI message.
  select count(*) into v_active_orders
  from public.orders o
  where o.customer_id = p_uid
    and o.status not in ('delivered', 'cancelled', 'rejected');
  if v_active_orders > 0 then
    raise exception 'PENDING_ORDERS [%]', v_active_orders;
  end if;

  -- ---------------- 1) anonymize order history ------------------------------
  -- Retained rows keep totals, items and timestamps (legal/accounting); all
  -- contact, address, precise-location and delivery-PIN data is removed.
  update public.orders set
    customer_name = 'Deleted user',
    phone = '',
    address_line = '',
    area = '',
    landmark = null,
    instructions = null,
    delivery_latitude = null,
    delivery_longitude = null,
    location_accuracy_meters = null,
    location_source = null,
    location_confirmed_at = null,
    delivery_house = null,
    delivery_street = null,
    delivery_locality = null,
    delivery_city = null,
    delivery_pincode = null,
    delivery_floor = null,
    delivery_pin = null
  where customer_id = p_uid
    and (customer_name <> 'Deleted user'
         or phone <> ''
         or address_line <> ''
         or area <> ''
         or landmark is not null
         or instructions is not null
         or delivery_latitude is not null
         or delivery_longitude is not null
         or location_source is not null
         or delivery_house is not null
         or delivery_street is not null
         or delivery_locality is not null
         or delivery_city is not null
         or delivery_pincode is not null
         or delivery_floor is not null
         or delivery_pin is not null);
  get diagnostics v_orders_anonymized = row_count;

  -- ---------------- 2) drop the analytics directory row ----------------------
  delete from public.user_activity where user_id = p_uid;
  get diagnostics v_activity_deleted = row_count;

  -- ---------------- 3) drop the profile row ---------------------------------
  delete from public.profiles where id = p_uid;
  v_profile_deleted := found;

  return jsonb_build_object(
    'ok', true,
    'orders_anonymized', v_orders_anonymized,
    'activity_rows_deleted', v_activity_deleted,
    'profile_deleted', v_profile_deleted
  );
end
$function$;

-- The purge is reachable ONLY from the server platform roles; no client
-- PostgREST session (anon, authenticated customer, or keyless request) may run it.
revoke all on function public.kv_delete_account_data(text, text) from public, anon, authenticated;
grant execute on function public.kv_delete_account_data(text, text) to service_role;
