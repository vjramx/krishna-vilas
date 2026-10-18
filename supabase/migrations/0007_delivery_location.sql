-- 0007_delivery_location: add destination data to existing orders. Existing
-- order RLS restricts rows to the customer, verified admins, and assigned
-- delivery agents; order-item SELECT below is extended to the assigned agent.
-- Coordinates describe the customer's chosen destination only; no live agent
-- tracking or location history is stored.

alter table public.orders
  add column if not exists delivery_latitude numeric(10,7),
  add column if not exists delivery_longitude numeric(10,7),
  add column if not exists location_accuracy_meters numeric(10,2),
  add column if not exists location_source text,
  add column if not exists location_confirmed_at timestamptz,
  add column if not exists delivery_house text,
  add column if not exists delivery_street text,
  add column if not exists delivery_locality text,
  add column if not exists delivery_city text,
  add column if not exists delivery_pincode text,
  add column if not exists delivery_floor text;

alter table public.orders
  drop constraint if exists orders_delivery_coordinates_pair_check,
  drop constraint if exists orders_delivery_latitude_check,
  drop constraint if exists orders_delivery_longitude_check,
  drop constraint if exists orders_location_accuracy_check,
  drop constraint if exists orders_location_source_check,
  drop constraint if exists orders_location_confirmation_check;

alter table public.orders
  add constraint orders_delivery_coordinates_pair_check
    check ((delivery_latitude is null) = (delivery_longitude is null)),
  add constraint orders_delivery_latitude_check
    check (delivery_latitude is null or delivery_latitude between -90 and 90),
  add constraint orders_delivery_longitude_check
    check (delivery_longitude is null or delivery_longitude between -180 and 180),
  add constraint orders_location_accuracy_check
    check (location_accuracy_meters is null or location_accuracy_meters >= 0),
  add constraint orders_location_source_check
    check (location_source is null or location_source in ('browser_geolocation', 'map_pin', 'manual_address')),
  add constraint orders_location_confirmation_check
    check (
      (delivery_latitude is null and location_confirmed_at is null)
      or (delivery_latitude is not null and location_confirmed_at is not null and location_source is not null and location_source in ('browser_geolocation', 'map_pin'))
    );

-- Assigned agents need order-item snapshots in the existing delivery detail
-- screen. Keep access scoped to the agent currently assigned to the parent row.
drop policy if exists order_items_read on public.order_items;
create policy order_items_read on public.order_items for select to public
  using (
    exists (
      select 1 from public.orders o
       where o.id = order_items.order_id
         and (
           o.customer_id = public.kv_subject()
           or public.is_administrator()
           or (public.is_agent() and o.agent_id = public.kv_agent_id()::text)
         )
    )
  );

-- Wrap the established SECURITY DEFINER checkout RPC rather than duplicating
-- price/offer/order-item logic. Both calls share one transaction: any failure
-- while saving location rolls back the order, snapshots and totals as well.
-- Idempotent duplicate responses deliberately do not rewrite saved location.
create or replace function public.place_order_with_location(
  p_items jsonb,
  p_customer_name text,
  p_phone text,
  p_address_line text,
  p_area text,
  p_landmark text default null,
  p_instructions text default null,
  p_idempotency_key uuid default null,
  p_delivery_latitude numeric default null,
  p_delivery_longitude numeric default null,
  p_location_accuracy_meters numeric default null,
  p_location_source text default 'manual_address',
  p_location_confirmed_at timestamptz default null,
  p_delivery_details jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_result jsonb;
  v_order_id uuid;
  v_duplicate boolean;
begin
  if (p_delivery_latitude is null) <> (p_delivery_longitude is null) then
    raise exception 'COORDINATES_INCOMPLETE';
  end if;
  if p_delivery_latitude is not null and p_delivery_latitude not between -90 and 90 then
    raise exception 'LATITUDE_INVALID';
  end if;
  if p_delivery_longitude is not null and p_delivery_longitude not between -180 and 180 then
    raise exception 'LONGITUDE_INVALID';
  end if;
  if p_location_accuracy_meters is not null and (
    p_location_accuracy_meters < 0
    or p_location_accuracy_meters::text in ('NaN', 'Infinity', '-Infinity')
  ) then
    raise exception 'LOCATION_ACCURACY_INVALID';
  end if;
  if p_location_source is null or p_location_source not in ('browser_geolocation', 'map_pin', 'manual_address') then
    raise exception 'LOCATION_SOURCE_INVALID';
  end if;
  if p_delivery_details is not null and jsonb_typeof(p_delivery_details) <> 'object' then
    raise exception 'DELIVERY_DETAILS_INVALID';
  end if;
  if length(coalesce(p_delivery_details->>'house', '')) > 120
     or length(coalesce(p_delivery_details->>'street', '')) > 120
     or length(coalesce(p_delivery_details->>'locality', '')) > 100
     or length(coalesce(p_delivery_details->>'city', '')) > 80
     or length(coalesce(p_delivery_details->>'pincode', '')) > 12
     or length(coalesce(p_delivery_details->>'floor', '')) > 80 then
    raise exception 'DELIVERY_DETAILS_INVALID';
  end if;
  if p_delivery_latitude is null then
    if p_location_source <> 'manual_address' or p_location_confirmed_at is not null then
      raise exception 'LOCATION_CONFIRMATION_INVALID';
    end if;
    p_location_accuracy_meters := null;
  elsif p_location_source not in ('browser_geolocation', 'map_pin') or p_location_confirmed_at is null then
    raise exception 'LOCATION_CONFIRMATION_INVALID';
  end if;

  v_result := public.place_order(
    p_items, p_customer_name, p_phone, p_address_line, p_area,
    p_landmark, p_instructions, p_idempotency_key
  );
  v_order_id := (v_result->>'order_id')::uuid;
  v_duplicate := coalesce((v_result->>'duplicate')::boolean, false);
  if not v_duplicate then
    update public.orders
       set delivery_latitude = p_delivery_latitude,
           delivery_longitude = p_delivery_longitude,
           location_accuracy_meters = p_location_accuracy_meters,
           location_source = p_location_source,
           location_confirmed_at = case when p_delivery_latitude is not null then now() else null end,
           delivery_house = nullif(btrim(p_delivery_details->>'house'), ''),
           delivery_street = nullif(btrim(p_delivery_details->>'street'), ''),
           delivery_locality = nullif(btrim(p_delivery_details->>'locality'), ''),
           delivery_city = nullif(btrim(p_delivery_details->>'city'), ''),
           delivery_pincode = nullif(btrim(p_delivery_details->>'pincode'), ''),
           delivery_floor = nullif(btrim(p_delivery_details->>'floor'), '')
     where id = v_order_id;
    if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  end if;
  return v_result;
end
$function$;

revoke all on function public.place_order_with_location(jsonb, text, text, text, text, text, text, uuid, numeric, numeric, numeric, text, timestamptz, jsonb) from public, anon;
grant execute on function public.place_order_with_location(jsonb, text, text, text, text, text, text, uuid, numeric, numeric, numeric, text, timestamptz, jsonb) to authenticated;
