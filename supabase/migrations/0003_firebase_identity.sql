-- 0003_firebase_identity: Firebase Auth becomes the identity source (third-party auth).
--
-- Identity rules after this migration:
--   * CUSTOMER identity = JWT `sub` (Firebase UID; Supabase-issued JWTs keep uuid subs for API tests)
--   * STAFF identity   = JWT `email` (admin_users / agent_users are matched by email)
-- * All RLS + RPC authorization rewritten from auth.uid() to claim-based helpers.
-- * Restrictive policies pin token issuers to this Supabase project and the
--   `krishna-vilas` Firebase project (generic JWKS integrations would otherwise
--   accept tokens minted by ANY firebase project).

-- ----------------------------------------------------------------- helpers
create or replace function public.kv_jwt_claims()
returns jsonb
language sql
stable
as $function$
  select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
$function$;

create or replace function public.kv_subject()
returns text
language sql
stable
as $function$
  select coalesce(public.kv_jwt_claims() ->> 'sub', '')
$function$;

create or replace function public.kv_email()
returns text
language sql
stable
as $function$
  select lower(coalesce(public.kv_jwt_claims() ->> 'email', ''))
$function$;

create or replace function public.is_allowed_issuer()
returns boolean
language sql
stable
as $function$
  select coalesce(
    (
      public.kv_jwt_claims() ->> 'iss' in (
        'https://reodbsfxkorpgzimqijn.supabase.co/auth/v1',
        'https://securetoken.google.com/krishna-vilas'
      )
      and (
        public.kv_jwt_claims() ->> 'iss' = 'https://reodbsfxkorpgzimqijn.supabase.co/auth/v1'
        or (
             public.kv_jwt_claims() ->> 'aud' = 'krishna-vilas'
         and coalesce(public.kv_jwt_claims() ->> 'email_verified', 'true') <> 'false'
        )
      )
    ), false)
$function$;

create or replace function public.kv_agent_id()
returns uuid
language sql
stable
security definer
set search_path = 'public'
as $function$
  select id from public.agent_users where lower(email) = public.kv_email() limit 1
$function$;

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $function$
  select exists(
    select 1 from public.admin_users a where lower(a.email) = public.kv_email() and a.email <> ''
  )
$function$;

create or replace function public.is_agent()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $function$
  select exists(
    select 1 from public.agent_users a
     where lower(a.email) = public.kv_email()
       and a.email <> ''
       and a.is_active
  )
$function$;

create or replace function public.is_current_admin()
returns boolean language sql stable as $$ select public.is_administrator() $$;
create or replace function public.is_current_agent()
returns boolean language sql stable as $$ select public.is_agent() $$;

-- ----------------------------------------------------------------- policy drops
-- (policies must be dropped before column types change)
drop policy if exists agents_admin_write   on public.agent_users;
drop policy if exists agents_select_own    on public.agent_users;
drop policy if exists agents_update_own    on public.agent_users;
drop policy if exists categories_admin     on public.categories;
drop policy if exists categories_read      on public.categories;
drop policy if exists settings_admin       on public.hotel_settings;
drop policy if exists settings_read        on public.hotel_settings;
drop policy if exists menu_admin           on public.menu_items;
drop policy if exists menu_read            on public.menu_items;
drop policy if exists order_items_read     on public.order_items;
drop policy if exists orders_admin_update  on public.orders;
drop policy if exists orders_agent_read    on public.orders;
drop policy if exists orders_read          on public.orders;
drop policy if exists profiles_select_own  on public.profiles;
drop policy if exists profiles_update_own  on public.profiles;
drop policy if exists offers_admin         on public.special_offers;
drop policy if exists offers_read          on public.special_offers;
drop policy if exists order_history_read   on public.order_status_history;
drop policy if exists order_history_admin_write on public.order_status_history;
drop policy if exists issuer_pin           on storage.objects;

-- ----------------------------------------------------------------- table surgery
alter table public.profiles  drop constraint if exists profiles_id_fkey;
alter table public.admin_users drop constraint if exists admin_users_id_fkey;
alter table public.agent_users drop constraint if exists agent_users_id_fkey;
alter table public.orders    drop constraint if exists orders_customer_id_fkey;
alter table public.orders    drop constraint if exists orders_agent_id_fkey;

alter table public.profiles  alter column id type text;
alter table public.orders    alter column customer_id type text;
alter table public.orders    alter column agent_id type text;
alter table public.orders    alter column cash_verified_by type text;
alter table public.admin_users alter column id drop default;
alter table public.agent_users alter column id set default gen_random_uuid();

-- fresh agent identity: agent_users.id stays a uuid surrogate, matched by email
delete from public.agent_users;
insert into public.agent_users (id, email, name_en, phone, is_active)
values (gen_random_uuid(), 'agent@krishnavilas.in', 'Demo Agent', null, true);

-- ----------------------------------------------------------------- policies
create policy agents_admin_write   on public.agent_users for all to public
  using (public.is_administrator()) with check (public.is_administrator());
create policy agents_select_own    on public.agent_users for select to public
  using (lower(email) = public.kv_email() or lower(email) <> '' and public.is_administrator());
create policy agents_update_own    on public.agent_users for update to public
  using (lower(email) = public.kv_email())
  with check (lower(email) = public.kv_email());

create policy categories_admin     on public.categories for all to public
  using (public.is_administrator()) with check (public.is_administrator());
create policy categories_read      on public.categories for select to public
  using (is_active or public.is_administrator());

create policy settings_admin       on public.hotel_settings for all to public
  using (public.is_administrator()) with check (public.is_administrator());
create policy settings_read        on public.hotel_settings for select to public using (true);

create policy menu_admin           on public.menu_items for all to public
  using (public.is_administrator()) with check (public.is_administrator());
create policy menu_read            on public.menu_items for select to public
  using (is_active or public.is_administrator());

create policy orders_read          on public.orders for select to public
  using (customer_id = public.kv_subject() or public.is_administrator());
create policy orders_agent_read    on public.orders for select to public
  using (public.is_agent() and agent_id = public.kv_agent_id()::text);
create policy orders_admin_update  on public.orders for update to public
  using (public.is_administrator()) with check (public.is_administrator());

create policy order_items_read     on public.order_items for select to public
  using (
    exists (
      select 1 from public.orders o
       where o.id = order_items.order_id
         and (o.customer_id = public.kv_subject() or public.is_administrator())
    )
  );

create policy profiles_select_own  on public.profiles for select to public
  using (id = public.kv_subject());
create policy profiles_update_own  on public.profiles for all to public
  using (id = public.kv_subject()) with check (id = public.kv_subject());

create policy offers_admin         on public.special_offers for all to public
  using (public.is_administrator()) with check (public.is_administrator());
create policy offers_read          on public.special_offers for select to public
  using ((is_active and now() between starts_at and ends_at) or public.is_administrator());

create policy order_history_read   on public.order_status_history for select to public
  using (
    exists (
      select 1 from public.orders o
       where o.id = order_status_history.order_id
         and (o.customer_id = public.kv_subject() or o.agent_id = public.kv_agent_id()::text or public.is_administrator())
    )
  );
create policy order_history_admin_write on public.order_status_history for insert to public
  with check (public.is_administrator());

-- Restrictive policies: only this Supabase project's tokens or the
-- `krishna-vilas` Firebase project's tokens may pass at all.
-- (storage.objects handled separately below)
do $$
declare
  t text;
begin
  for t in
    select table_name from information_schema.tables
     where table_schema = 'public' and table_type = 'BASE TABLE'
  loop
    execute format(
      'drop policy if exists issuer_pin on public.%I;
       create policy issuer_pin on public.%I as restrictive for select to public
         using ((select public.is_allowed_issuer()) is true);', t, t);
  end loop;
end $$;

drop policy if exists issuer_pin on storage.objects;
create policy issuer_pin on storage.objects as restrictive for all to public
  using ((select public.is_allowed_issuer()) is true)
  with check ((select public.is_allowed_issuer()) is true);

-- ----------------------------------------------------------------- RPCs rewrite
-- place_order: customer identity comes from the JWT subject claim.
delete from public.orders where false; -- touch nothing, ready below

drop function if exists public.place_order(jsonb, text, text, text, text, text, text, uuid);
create or replace function public.place_order(
  p_items jsonb, p_customer_name text, p_phone text, p_address_line text,
  p_area text, p_landmark text default null, p_instructions text default null,
  p_idempotency_key uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_uid       text := public.kv_subject();
  v_setting   public.hotel_settings;
  v_it        jsonb;
  v_item      public.menu_items%rowtype;
  v_qty       int;
  v_line_total numeric(10,2);
  v_best      numeric(10,2);
  v_subtotal  numeric(10,2) := 0;
  v_discount  numeric(10,2) := 0;
  v_fee       numeric(10,2);
  v_total     numeric(10,2);
  v_order_id  uuid;
  v_number    text;
  v_eta       int;
  v_existing  public.orders%rowtype;
begin
  if v_uid is null or v_uid = '' then raise exception 'AUTH_REQUIRED'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0
     then raise exception 'ITEMS_REQUIRED'; end if;
  if p_customer_name is null or length(btrim(p_customer_name)) < 2
     or length(p_customer_name) > 80 then raise exception 'NAME_INVALID'; end if;
  if p_phone !~ '^[6-9][0-9]{9}$' then raise exception 'PHONE_INVALID'; end if;
  if p_address_line is null or length(btrim(p_address_line)) < 5
     or length(p_address_line) > 250 then raise exception 'ADDRESS_INVALID'; end if;
  if p_area is null or length(btrim(p_area)) < 2 or length(p_area) > 80
     then raise exception 'AREA_INVALID'; end if;
  if p_idempotency_key is null then raise exception 'IDEMPOTENCY_REQUIRED'; end if;

  select s.* into v_setting from public.hotel_settings s where s.id = 1 for update;
  if not found then raise exception 'HOTEL_NOT_CONFIGURED'; end if;

  if not v_setting.is_accepting_orders then raise exception 'NOT_ACCEPTING_ORDERS'; end if;
  if v_setting.is_open_override is false
     or (v_setting.is_open_override is null and (
       (select count(*) from unnest(v_setting.closed_weekdays) d
         where d = extract(dow from now() at time zone 'Asia/Kolkata')::smallint) > 0
       or (now() at time zone 'Asia/Kolkata')::time < v_setting.opens_at
       or (now() at time zone 'Asia/Kolkata')::time > v_setting.closes_at)) then
    raise exception 'HOTEL_CLOSED';
  end if;

  select * into v_existing from public.orders
   where idempotency_key = p_idempotency_key and customer_id = v_uid;
  if found then
    return jsonb_build_object(
      'duplicate', true,
      'order_id', v_existing.id,
      'order_number', v_existing.order_number,
      'status', v_existing.status,
      'total', v_existing.total);
  end if;

  v_eta := v_setting.default_prep_minutes + v_setting.default_delivery_minutes;
  v_fee := v_setting.delivery_fee;

  insert into public.orders (
    order_number, customer_id, customer_name, phone,
    address_line, area, landmark, instructions,
    payment_method, fulfillment, status,
    subtotal, discount_total, delivery_fee, total,
    eta_minutes, eta_updated_at, idempotency_key)
  values (
    'KV-' || to_char(now(),'YYMMDD') || '-' || lpad(nextval('public.order_seq')::text, 4, '0'),
    v_uid, btrim(p_customer_name), p_phone,
    btrim(p_address_line), btrim(p_area),
    nullif(btrim(coalesce(p_landmark,'')), ''),
    nullif(btrim(coalesce(p_instructions,'')), ''),
    'cod', 'delivery', 'pending',
    0, 0, v_fee, 0,
    v_eta, now(), p_idempotency_key)
  returning id, order_number into v_order_id, v_number;

  for v_it in select * from jsonb_array_elements(p_items) loop
    if v_it->>'item_id' is null or v_it->>'item_id' !~ '^[0-9a-fA-F-]{36}$'
       then raise exception 'ITEM_ID_INVALID'; end if;
    if (v_it->>'quantity') is null or (v_it->>'quantity') !~ '^[0-9]+$'
       then raise exception 'QUANTITY_INVALID'; end if;
    v_qty := (v_it->>'quantity')::int;
    if v_qty < 1 or v_qty > 50 then raise exception 'QUANTITY_INVALID'; end if;

    select * into v_item from public.menu_items where id = (v_it->>'item_id')::uuid;
    if not found then raise exception 'ITEM_NOT_FOUND:%', v_it->>'item_id'; end if;
    if not v_item.is_active or not v_item.is_available
       then raise exception 'ITEM_UNAVAILABLE:%', v_item.name_en; end if;

    select coalesce(max(
      case o.discount_type
        when 'percent' then least(v_item.price, round(v_item.price * o.discount_value / 100, 2))
        else least(v_item.price, o.discount_value)
      end), 0)::numeric(10,2) into v_best
    from public.special_offers o
    where o.is_active
      and now() between o.starts_at and o.ends_at
      and (
        (o.scope = 'item'     and o.target_id = v_item.id) or
        (o.scope = 'category' and o.target_id = v_item.category_id) or
        o.scope = 'all'
      );

    v_line_total := v_item.price * v_qty;
    v_subtotal := v_subtotal + v_line_total;
    v_discount := v_discount + v_best * v_qty;

    insert into public.order_items (
      order_id, menu_item_id, name_en, name_kn,
      unit_price, quantity, discount_amount, item_total)
    values (v_order_id, v_item.id, v_item.name_en, v_item.name_kn,
            v_item.price, v_qty, v_best * v_qty, v_line_total - v_best * v_qty);
  end loop;

  if v_setting.min_order_total > 0 and v_subtotal < v_setting.min_order_total then
    raise exception 'MIN_ORDER_NOT_MET:%', v_setting.min_order_total;
  end if;

  v_total := v_subtotal - v_discount + v_fee;
  if v_total < 0 then raise exception 'PRICE_ERROR'; end if;

  update public.orders
     set subtotal = v_subtotal,
         discount_total = v_discount,
         total = v_total
   where id = v_order_id;

  return jsonb_build_object(
    'duplicate', false,
    'order_id', v_order_id,
    'order_number', v_number,
    'status', 'pending',
    'subtotal', v_subtotal,
    'discount_total', v_discount,
    'delivery_fee', v_fee,
    'total', v_total,
    'eta_minutes', v_eta);
end
$function$;

-- staff grant functions: bind roles by Google account email (no auth.users lookup)
drop function if exists public.staff_grant_agent(text, text, text);
create or replace function public.staff_grant_agent(
  p_email text, p_name text default null, p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_administrator() then raise exception 'NOT_ADMINISTRATOR'; end if;
  if p_email is null or p_email !~ '^\S+@\S+\.\S+$' then raise exception 'FIELD_EMAIL'; end if;

  insert into public.agent_users (email, name_en, phone, is_active)
  values (lower(btrim(p_email)), coalesce(nullif(btrim(p_name), ''), split_part(p_email, '@', 1)), p_phone, true)
  on conflict (email) do update
    set name_en = excluded.name_en,
        phone = coalesce(excluded.phone, agent_users.phone),
        is_active = true
  returning id into v_id;

  insert into public.profiles (id) values (v_id::text) on conflict (id) do nothing;
  return v_id;
end
$function$;

drop function if exists public.staff_grant_admin(text);
create or replace function public.staff_grant_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_id uuid;
begin
  if not public.is_administrator() then raise exception 'NOT_ADMINISTRATOR'; end if;
  if p_email is null or p_email !~ '^\S+@\S+\.\S+$' then raise exception 'FIELD_EMAIL'; end if;

  insert into public.admin_users (id, email)
  values (gen_random_uuid(), lower(btrim(p_email)))
  on conflict (email) do update set email = excluded.email
  returning id into v_id;
  return v_id;
end
$function$;

-- assign_order: agent_id is the agent_users surrogate uuid (text column now)
drop function if exists public.assign_order(uuid, uuid);
create or replace function public.assign_order(p_order_id uuid, p_agent_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_market public.orders%rowtype;
begin
  if not public.is_administrator() then raise exception 'NOT_ADMINISTRATOR'; end if;
  if p_agent_id is not null and not exists(
      select 1 from public.agent_users a where a.id = p_agent_id and a.is_active) then
    raise exception 'AGENT_INACTIVE';
  end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_market.status in ('pending','rejected') then raise exception 'NOT_DISPATCHABLE'; end if;
  if v_market.status = 'delivered' or v_market.assignment_status in ('picked_up','delivered') then
    raise exception 'ALREADY_PICKED_UP';
  end if;
  update public.orders
     set agent_id = p_agent_id::text,
         assignment_status = case when p_agent_id is null then 'none' else 'assigned' end,
         accepted_at = null, arrived_at = null, picked_up_at = null
   where id = p_order_id;
end
$function$;

drop function if exists public.verify_cash(uuid);
create or replace function public.verify_cash(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_market public.orders%rowtype;
begin
  if not public.is_administrator() then raise exception 'NOT_ADMINISTRATOR'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_market.cash_handed_at is null then raise exception 'NOT_HANDED_OVER'; end if;
  update public.orders
     set cash_verified_by = public.kv_subject(),
         cash_verified_at = now()
   where id = p_order_id;
end
$function$;

-- agent RPCs: authorization by users email claim (kv_agent_id)
drop function if exists public.agent_accept(uuid);
create or replace function public.agent_accept(p_order_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $function$
declare v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  if v_market.assignment_status <> 'assigned' then raise exception 'WRONG_STATE:%', v_market.assignment_status; end if;
  update public.orders set assignment_status = 'accepted', accepted_at = now() where id = p_order_id;
end
$function$;

drop function if exists public.agent_decline(uuid);
create or replace function public.agent_decline(p_order_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $function$
declare v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  if v_market.assignment_status <> 'assigned' then raise exception 'WRONG_STATE:%', v_market.assignment_status; end if;
  update public.orders set agent_id = null, assignment_status = 'none' where id = p_order_id;
end
$function$;

drop function if exists public.agent_arrived(uuid);
create or replace function public.agent_arrived(p_order_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $function$
declare v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  if v_market.assignment_status <> 'accepted' then raise exception 'WRONG_STATE:%', v_market.assignment_status; end if;
  update public.orders set arrived_at = now() where id = p_order_id;
end
$function$;

drop function if exists public.agent_pickup(uuid);
create or replace function public.agent_pickup(p_order_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $function$
declare v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  if v_market.assignment_status <> 'accepted' or v_market.status <> 'out_for_delivery' then
    raise exception 'NOT_DISPATCHED';
  end if;
  update public.orders set picked_up_at = now(), assignment_status = 'picked_up' where id = p_order_id;
end
$function$;

drop function if exists public.agent_deliver(uuid, text, numeric);
create or replace function public.agent_deliver(p_order_id uuid, p_pin text, p_collected numeric)
returns void language plpgsql security definer set search_path = 'public' as $function$
declare v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  if v_market.assignment_status <> 'picked_up' or v_market.status <> 'out_for_delivery' then
    raise exception 'WRONG_STATE';
  end if;
  if v_market.delivery_pin is null or p_pin is null or p_pin <> v_market.delivery_pin then raise exception 'PIN_MISMATCH'; end if;
  if p_collected is null or p_collected < 0 or p_collected > v_market.total then raise exception 'AMOUNT_INVALID'; end if;
  update public.orders
     set status = 'delivered', delivered_at = now(), assignment_status = 'delivered',
         cod_expected = v_market.total, cod_collected = p_collected
   where id = p_order_id;
end
$function$;

drop function if exists public.agent_fail(uuid, text);
create or replace function public.agent_fail(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = 'public' as $function$
declare v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  if v_market.assignment_status not in ('accepted','picked_up') then
    raise exception 'WRONG_STATE:%', v_market.assignment_status;
  end if;
  update public.orders set assignment_status = 'failed', delivery_fail_reason = btrim(p_reason) where id = p_order_id;
end
$function$;

drop function if exists public.agent_hand_cash(uuid);
create or replace function public.agent_hand_cash(p_order_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $function$
declare v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  if v_market.cod_collected is null then raise exception 'NOTHING_RECORDED'; end if;
  if v_market.cash_handed_at is not null then raise exception 'ALREADY_HANDED'; end if;
  update public.orders set cash_handed_at = now() where id = p_order_id;
end
$function$;

-- set_order_status / set_order_eta unchanged in logic (admin-only via
-- is_administrator()); recreate to pin search_path and pick up new helpers.
drop function if exists public.set_order_status(uuid, text, text);
create or replace function public.set_order_status(p_order_id uuid, p_new_status text, p_note text default null)
returns jsonb language plpgsql security definer set search_path = 'public' as $function$
declare
  v_order public.orders%rowtype;
begin
  if not public.is_administrator() then raise exception 'NOT_ADMINISTRATOR'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.status in ('delivered','rejected') then raise exception 'FINAL_STATE'; end if;
  if not (
        (v_order.status = 'pending'           and p_new_status in ('confirmed','rejected')) or
        (v_order.status = 'confirmed'         and p_new_status in ('preparing','rejected')) or
        (v_order.status = 'preparing'         and p_new_status = 'ready') or
        (v_order.status = 'ready'             and p_new_status = 'out_for_delivery') or
        (v_order.status = 'out_for_delivery'  and p_new_status = 'delivered')
      ) then
    raise exception 'INVALID_TRANSITION:%->%', v_order.status, p_new_status;
  end if;
  update public.orders set
    status = p_new_status,
    confirmed_at        = case when p_new_status = 'confirmed'        then now() else confirmed_at end,
    preparing_at        = case when p_new_status = 'preparing'        then now() else preparing_at end,
    ready_at            = case when p_new_status = 'ready'            then now() else ready_at end,
    out_for_delivery_at = case when p_new_status = 'out_for_delivery' then now() else out_for_delivery_at end,
    delivered_at        = case when p_new_status = 'delivered'        then now() else delivered_at end,
    rejected_at         = case when p_new_status = 'rejected'         then now() else rejected_at end,
    reject_reason       = case when p_new_status = 'rejected'         then coalesce(p_note, '') else reject_reason end,
    delay_note          = p_note
  where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', p_new_status);
end
$function$;

drop function if exists public.set_order_eta(uuid, integer, text);
create or replace function public.set_order_eta(p_order_id uuid, p_eta_minutes integer, p_note text default null)
returns void language plpgsql security definer set search_path = 'public' as $function$
begin
  if not public.is_administrator() then raise exception 'NOT_ADMINISTRATOR'; end if;
  if p_eta_minutes is null or p_eta_minutes < 1 or p_eta_minutes > 600 then raise exception 'ETA_INVALID'; end if;
  update public.orders
     set eta_minutes = p_eta_minutes, eta_updated_at = now(), delay_note = p_note
   where id = p_order_id;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
end
$function$;
