-- 0023_admin_directory_roles: directory over real accounts + role chips, and
-- direct role granting for existing users.
--
-- Problem(s) this fixes:
--   1. Admin → Users built its directory from user_activity rows only, and
--      kv_record_user_activity() deliberately EXCLUDES staff from activity —
--      so the owner (vijayramv229@gmail.com) never appeared in the directory
--      at all, let alone as "Super admin". Users now come from auth.users
--      (every confirmed account), enriched with activity/order data.
--   2. The only way to make someone staff was to invite them and wait for a
--      matching sign-in. The super admin can now grant — or change — a role
--      directly for any ALREADY REGISTERED user from the Add-admin picker
--      (staff_grant_admin is upgraded to take the role). The email invitation
--      flow remains for people who have not signed up yet.

-- Re-assert the owner bootstrap (idempotent — no client can grant this).
insert into public.admin_users (id, email, role)
select gen_random_uuid(), 'vijayramv229@gmail.com', 'super_admin'
where not exists (
  select 1 from public.admin_users where lower(email) = 'vijayramv229@gmail.com'
);
update public.admin_users
   set role = 'super_admin'
 where lower(email) = 'vijayramv229@gmail.com'
   and coalesce(role, '') <> 'super_admin';

-- ------------------------------------------------------- directory over auth.users
-- Same signature and overall shape as 0008 (the dashboard formulas stay
-- activity-based for continuity), but the user rows now come from
-- auth.users LEFT JOIN activity, so every registered account is visible —
-- including staff. Each row gains admin_role (null | 'admin' | 'super_admin')
-- matched by verified email, mirroring is_administrator/is_super_admin.
create or replace function public.admin_user_directory(
  p_search text default null,
  p_filter text default 'all',
  p_limit integer default 25,
  p_offset integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'auth'
as $function$
declare
  v_day_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata');
  v_week_start timestamptz := now() - interval '7 days';
  v_filter text := coalesce(p_filter, 'all');
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit integer := greatest(1, least(coalesce(p_limit, 25), 100));
  v_offset integer := greatest(0, coalesce(p_offset, 0));
  v_result jsonb;
begin
  if not public.is_allowed_issuer() or not public.is_administrator() then
    raise exception 'NOT_ADMINISTRATOR';
  end if;
  if v_filter not in ('all', 'new', 'active') then raise exception 'FIELD_FILTER'; end if;

  with order_counts as (
    select o.customer_id, count(*) as order_count
    from public.orders o
    group by o.customer_id
  ), all_users as (
    select u.id as user_id,
      lower(u.email) as email_key,
      u.email,
      coalesce(nullif(btrim(ua.display_name::text), ''), nullif(btrim(coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name', '')), '')) as display_name,
      ua.first_seen_at,
      ua.last_seen_at,
      coalesce(oc.order_count, 0) as order_count,
      a.role as admin_role
    from auth.users u
    left join public.user_activity ua on ua.user_id = u.id::text
    left join order_counts oc on oc.customer_id = u.id::text
    left join public.admin_users a on lower(a.email) = lower(u.email) and a.email <> ''
  ), filtered as (
    select * from all_users u
    where (v_search is null
           or u.email ilike '%' || v_search || '%'
           or coalesce(u.display_name, '') ilike '%' || v_search || '%')
      and (v_filter <> 'new'    or u.first_seen_at >= v_day_start)
      and (v_filter <> 'active' or u.last_seen_at  >= v_week_start)
  )
  select jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'active_today', (select count(*) from public.user_activity where last_seen_at >= v_day_start),
    'active_7_days', (select count(*) from public.user_activity where last_seen_at >= v_week_start),
    'new_today', (select count(*) from public.user_activity where first_seen_at >= v_day_start),
    'total_results', (select count(*) from filtered),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', f.user_id, 'email', f.email, 'display_name', f.display_name,
        'first_seen_at', f.first_seen_at, 'last_seen_at', f.last_seen_at,
        'order_count', f.order_count, 'admin_role', f.admin_role
      ) order by f.last_seen_at desc nulls last, f.email)
      from (select * from filtered order by last_seen_at desc nulls last, email limit v_limit offset v_offset) f
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end
$function$;

-- The directory is visibility-only for admins; guarded internally via
-- is_administrator(), so both DB roles may call it (Firebase SDK pattern).
revoke execute on function public.admin_user_directory(text, text, integer, integer) from public, anon;
grant execute on function public.admin_user_directory(text, text, integer, integer) to anon, authenticated;

-- ------------------------------------------------- direct grant for existing users
-- Upgraded over the 0004 single-role form: the super admin now picks the role
-- at grant time, an already-registered user is required (email invitations
-- cover unregistered admins), and the last super admin can never be demoted.
drop function if exists public.staff_grant_admin(text);
create or replace function public.staff_grant_admin(p_email text, p_role text default 'admin')
returns uuid
language plpgsql
security definer
set search_path = 'public', 'auth'
as $function$
declare
  v_uid uuid;
  v_email text;
  v_role text;
  v_current_role text;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  v_role := coalesce(p_role, 'admin');
  if v_email !~ '^\S+@\S+\.\S+$' then raise exception 'FIELD_EMAIL'; end if;
  if v_role not in ('admin', 'super_admin') then raise exception 'FIELD_ROLE'; end if;
  if v_email = public.kv_email() then raise exception 'CANNOT_INVITE_SELF'; end if;

  -- Only an already registered, confirmed account can be granted directly.
  select u.id into v_uid
    from auth.users u
   where lower(u.email) = v_email
     and u.email_confirmed_at is not null
   limit 1;
  if v_uid is null then
    raise exception 'USER_NOT_SIGNED_UP:%', v_email;
  end if;

  select role into v_current_role from public.admin_users where lower(email) = v_email limit 1;
  if v_current_role = v_role then raise exception 'ALREADY_ADMIN'; end if;

  -- Demotion guard: never leave the project without a living super admin.
  if v_current_role = 'super_admin' and v_role = 'admin' and (
    select count(*) from public.admin_users where role = 'super_admin'
  ) <= 1 then
    raise exception 'LAST_SUPER_ADMIN';
  end if;

  -- One row per account: clear stale invitation-accepted rows for this email
  -- (their ids are synthetic uuids), then upsert keyed by the auth user id.
  delete from public.admin_users where lower(email) = v_email and id <> v_uid;
  insert into public.admin_users (id, email, role)
  values (v_uid, btrim(p_email), v_role)
  on conflict (id) do update set email = excluded.email, role = excluded.role;
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  perform public.kv_audit('admin.access.granted', 'admin_user', v_email,
    jsonb_build_object('role', v_role));
  return v_uid;
end
$function$;

revoke execute on function public.staff_grant_admin(text, text) from public, anon, authenticated;
grant execute on function public.staff_grant_admin(text, text) to anon, authenticated;
