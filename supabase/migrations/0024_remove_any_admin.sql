-- 0024_remove_any_admin: the super admin may now remove ANY other admin,
-- including another super admin ("whomever is not needed"). The previous
-- blanket CANNOT_REMOVE_SUPER_ADMIN guard was stricter than necessary:
--
--   * Self-removal was already impossible (CANNOT_REMOVE_SELF) — and a caller
--     message in their own words did request removal of admins they no longer
--     need, including ones they themselves promoted to super admin.
--   * Removing some OTHER super admin always leaves ≥ 1 living super admin
--     (the caller), so the LAST_SUPER_ADMIN invariant cannot be violated here.
--     The demotion guard on staff_grant_admin (0023) stays as the only path
--     that can ever hit that invariant.
--
-- Rails kept: NOT_SUPER_ADMIN, CANNOT_REMOVE_SELF, missing row → false.
-- Every removal (incl. of a super admin) is audit-logged with its old role.

create or replace function public.staff_remove_admin(p_email text)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_email text;
  v_role text;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = public.kv_email() then raise exception 'CANNOT_REMOVE_SELF'; end if;
  select role into v_role from public.admin_users where lower(email) = v_email limit 1;
  if v_role is null then return false; end if;
  delete from public.admin_users where lower(email) = v_email;
  perform public.kv_audit('admin.access.removed', 'admin_user', v_email,
    jsonb_build_object('previous_role', v_role));
  return true;
end
$function$;

-- CREATE OR REPLACE keeps existing ACLs, but re-assert them so future
-- re-runs of this statement from a fresh database behave like 0004 did.
revoke execute on function public.staff_remove_admin(text) from public, anon, authenticated;
grant execute on function public.staff_remove_admin(text) to authenticated;
