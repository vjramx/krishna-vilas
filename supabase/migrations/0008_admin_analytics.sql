-- 0008_admin_analytics: secure dashboard aggregates and privacy-minimal
-- authenticated customer activity. No client query reads auth.users.

create table if not exists public.user_activity (
  user_id text primary key,
  email text not null,
  display_name text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists user_activity_last_seen_idx
  on public.user_activity (last_seen_at desc);
create index if not exists user_activity_first_seen_idx
  on public.user_activity (first_seen_at desc);
create index if not exists orders_customer_created_idx
  on public.orders (customer_id, created_at desc);
create index if not exists orders_created_at_idx on public.orders (created_at desc);
create index if not exists orders_delivered_at_idx on public.orders (delivered_at desc) where status = 'delivered';
create index if not exists orders_cash_unverified_idx on public.orders (status, cash_verified_at) where status in ('delivered', 'out_for_delivery');

alter table public.user_activity enable row level security;
drop policy if exists user_activity_admin_read on public.user_activity;
create policy user_activity_admin_read on public.user_activity
  for select to public
  using (public.is_allowed_issuer() and public.is_administrator());

-- One row per Firebase UID. The identity and email are taken from the verified
-- JWT; the client cannot nominate another user or write arbitrary activity.
create or replace function public.kv_record_user_activity()
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_uid text := public.kv_subject();
  v_email text := public.kv_email();
  v_name text := nullif(left(btrim(coalesce(public.kv_jwt_claims() ->> 'name', '')), 80), '');
begin
  if v_uid = '' or v_email = '' or not public.is_allowed_issuer() then
    raise exception 'AUTH_REQUIRED';
  end if;
  -- Keep staff out of customer analytics and directory.
  if public.is_administrator() or exists (
    select 1 from public.agent_users a where lower(a.email) = v_email
  ) then return; end if;

  insert into public.user_activity (user_id, email, display_name)
  values (v_uid, v_email, v_name)
  on conflict (user_id) do update
    set email = excluded.email,
        display_name = coalesce(excluded.display_name, user_activity.display_name),
        last_seen_at = now();
end
$function$;

-- Firebase ID tokens use the Postgres anon role in this project (they do not
-- contain a Supabase role claim). Allow the anon DB role to call this guarded
-- security-definer function; it derives identity only from verified JWT claims.
revoke execute on function public.kv_record_user_activity() from public, anon;
grant execute on function public.kv_record_user_activity() to anon, authenticated;

-- A single bounded aggregate request serves the dashboard. Monetary metrics:
-- order value is placed-order total for non-cancelled/non-rejected orders;
-- delivered sales are orders delivered today; COD pending is expected minus
-- collected for delivered/out-for-delivery orders not cash-verified; verified
-- COD collections are summed only after cash_verified_at is set.
create or replace function public.admin_dashboard_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public'
as $function$
declare
  v_day_start timestamptz := ((now() at time zone 'Asia/Kolkata')::date::timestamp at time zone 'Asia/Kolkata');
  v_result jsonb;
begin
  if not public.is_allowed_issuer() or not public.is_administrator() then
    raise exception 'NOT_ADMINISTRATOR';
  end if;

  select jsonb_build_object(
    'pending', count(*) filter (where status = 'pending'),
    'confirmed', count(*) filter (where status = 'confirmed'),
    'preparing', count(*) filter (where status = 'preparing'),
    'ready', count(*) filter (where status = 'ready'),
    'out_for_delivery', count(*) filter (where status = 'out_for_delivery'),
    'delivered', count(*) filter (where status = 'delivered'),
    'rejected', count(*) filter (where status = 'rejected'),
    'cancelled', count(*) filter (where status = 'cancelled'),
    'orders_today', count(*) filter (where created_at >= v_day_start),
    'order_value_today', coalesce(sum(total) filter (
      where created_at >= v_day_start and status not in ('cancelled', 'rejected')), 0),
    'delivered_sales_today', coalesce(sum(total) filter (
      where status = 'delivered' and delivered_at >= v_day_start), 0),
    'cod_pending', coalesce(sum(greatest(coalesce(cod_expected, total) - coalesce(cod_collected, 0), 0)) filter (
      where status in ('delivered', 'out_for_delivery') and cash_verified_at is null), 0),
    'cod_verified', coalesce(sum(coalesce(cod_collected, 0)) filter (
      where cash_verified_at is not null), 0),
    'last_7_days', coalesce((
      select jsonb_agg(jsonb_build_object(
        'date', days.day::date,
        'orders', coalesce(daily.orders, 0),
        'order_value', coalesce(daily.order_value, 0)
      ) order by days.day)
      from generate_series(v_day_start - interval '6 days', v_day_start, interval '1 day') as days(day)
      left join (
        select (created_at at time zone 'Asia/Kolkata')::date as day,
          count(*) as orders,
          coalesce(sum(total) filter (where status not in ('cancelled', 'rejected')), 0) as order_value
        from public.orders
        where created_at >= v_day_start - interval '6 days'
        group by (created_at at time zone 'Asia/Kolkata')::date
      ) daily on daily.day = days.day::date
    ), '[]'::jsonb)
  ) into v_result
  from public.orders;

  return v_result;
end
$function$;

-- The function validates Firebase issuer and administrator email internally;
-- grant to anon because Firebase-backed frontend requests use that DB role.
revoke execute on function public.admin_dashboard_summary() from public, anon;
grant execute on function public.admin_dashboard_summary() to anon, authenticated;

-- Returns scoped aggregate counts plus a bounded, searchable directory. All
-- account rows come from authenticated app sessions recorded above, never
-- from an unbounded auth.users query. first_seen_at is explicitly first
-- observed app session, not a Firebase registration timestamp.
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
set search_path = 'public'
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
    select ua.user_id, ua.email, ua.display_name, ua.first_seen_at, ua.last_seen_at,
      coalesce(oc.order_count, 0) as order_count
    from public.user_activity ua
    left join order_counts oc on oc.customer_id = ua.user_id
  ), filtered as (
    select * from all_users u
    where (v_search is null or u.email ilike '%' || v_search || '%' or coalesce(u.display_name, '') ilike '%' || v_search || '%')
      and (v_filter <> 'new' or u.first_seen_at >= v_day_start)
      and (v_filter <> 'active' or u.last_seen_at >= v_week_start)
  )
  select jsonb_build_object(
    'total_users', (select count(*) from public.user_activity),
    'active_today', (select count(*) from public.user_activity where last_seen_at >= v_day_start),
    'active_7_days', (select count(*) from public.user_activity where last_seen_at >= v_week_start),
    'new_today', (select count(*) from public.user_activity where first_seen_at >= v_day_start),
    'total_results', (select count(*) from filtered),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', f.user_id, 'email', f.email, 'display_name', f.display_name,
        'first_seen_at', f.first_seen_at, 'last_seen_at', f.last_seen_at,
        'order_count', f.order_count
      ) order by f.last_seen_at desc)
      from (select * from filtered order by last_seen_at desc limit v_limit offset v_offset) f
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end
$function$;

revoke execute on function public.admin_user_directory(text, text, integer, integer) from public, anon;
grant execute on function public.admin_user_directory(text, text, integer, integer) to anon, authenticated;

-- Refresh PostgREST's API schema cache after these RPCs are created. This
-- only refreshes API metadata; it does not change table data or RLS policies.
notify pgrst, 'reload schema';
