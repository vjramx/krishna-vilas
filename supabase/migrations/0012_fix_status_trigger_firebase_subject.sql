-- 0012_fix_status_trigger_firebase_subject
--
-- Root cause of "admin cannot accept orders": the log_status_change trigger
-- called auth.uid(), which casts the JWT `sub` claim to uuid. With Firebase
-- third-party auth the subject is a Firebase UID (e.g. `7cu9dnQx…`, 28 chars,
-- no dashes), so the cast threw `22P02 invalid input syntax for type uuid`
-- and every UPDATE of an order (set_order_status, cancel, dispatch…) failed
-- with an opaque client-side error. Customer order placement kept working
-- because place_order only INSERTs (trigger is update-scoped).
--
-- Fix: read the JWT subject directly and store it as uuid only when it truly
-- is one (GoTrue-style), else NULL. The audit value is best-effort identity;
-- the full trail (order_id, old_status, new_status, created_at) is unaffected.

create or replace function public.kv_jwt_subject_uuid()
returns uuid
language sql
stable
set search_path = 'public'
as $$
  select case
    when coalesce(current_setting('request.jwt.claims', true)::json ->> 'sub', '')
         ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-9a][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    then (current_setting('request.jwt.claims', true)::json ->> 'sub')::uuid
    else null
  end
$$;

revoke all on function public.kv_jwt_subject_uuid() from public, anon, authenticated;

create or replace function public.log_status_change()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $$
begin
  if old.status is distinct from new.status then
    insert into public.order_status_history (order_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, public.kv_jwt_subject_uuid());
  end if;
  return new;
end
$$;
