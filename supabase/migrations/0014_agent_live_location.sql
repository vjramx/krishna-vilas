-- 0014_agent_live_location: Swiggy/Zomato-style live tracking.
--
-- The assigned delivery agent shares their GPS position while the order is
-- out for delivery. Only the LATEST point is kept on the order row (no
-- location history). The customer reads it through the existing orders_read
-- policy, so Realtime pushes each update to the customer's order page.
--
-- Privacy: coordinates are cleared as soon as the order reaches a final state
-- (delivered / rejected / cancelled) or the agent is unassigned.

alter table public.orders
  add column if not exists agent_latitude numeric(10,7),
  add column if not exists agent_longitude numeric(10,7),
  add column if not exists agent_location_accuracy_meters numeric(10,2),
  add column if not exists agent_location_at timestamptz;

alter table public.orders
  drop constraint if exists orders_agent_coordinates_pair_check,
  drop constraint if exists orders_agent_latitude_check,
  drop constraint if exists orders_agent_longitude_check,
  drop constraint if exists orders_agent_location_accuracy_check;

alter table public.orders
  add constraint orders_agent_coordinates_pair_check
    check ((agent_latitude is null) = (agent_longitude is null) and (agent_location_at is null) = (agent_latitude is null)),
  add constraint orders_agent_latitude_check
    check (agent_latitude is null or agent_latitude between -90 and 90),
  add constraint orders_agent_longitude_check
    check (agent_longitude is null or agent_longitude between -180 and 180),
  add constraint orders_agent_location_accuracy_check
    check (agent_location_accuracy_meters is null or agent_location_accuracy_meters >= 0);

-- Agent reports its position. Authorized only for the assigned agent while the
-- order is on the road (accepted or picked up, and out_for_delivery).
create or replace function public.agent_report_location(
  p_order_id uuid,
  p_latitude numeric,
  p_longitude numeric,
  p_accuracy_meters numeric default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  if p_latitude is null or p_longitude is null then raise exception 'COORDINATES_REQUIRED'; end if;
  if p_latitude not between -90 and 90 then raise exception 'LATITUDE_INVALID'; end if;
  if p_longitude not between -180 and 180 then raise exception 'LONGITUDE_INVALID'; end if;
  if p_accuracy_meters is not null and p_accuracy_meters < 0 then raise exception 'LOCATION_ACCURACY_INVALID'; end if;

  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  if v_market.status <> 'out_for_delivery' or v_market.assignment_status not in ('accepted', 'picked_up') then
    raise exception 'NOT_ON_ROUTE';
  end if;

  update public.orders
     set agent_latitude = p_latitude,
         agent_longitude = p_longitude,
         agent_location_accuracy_meters = p_accuracy_meters,
         agent_location_at = now()
   where id = p_order_id;
end
$function$;

revoke all on function public.agent_report_location(uuid, numeric, numeric, numeric) from public;
-- Same reasoning as place_order_with_location: staff/customer Firebase tokens
-- run as the `anon` role, so the in-function NOT_AGENT / NOT_ASSIGNED checks
-- are the real gate.
grant execute on function public.agent_report_location(uuid, numeric, numeric, numeric) to anon, authenticated;

-- Never keep a stale agent position once the trip is over.
create or replace function public.clear_agent_location_on_close()
returns trigger
language plpgsql
set search_path = 'public'
as $function$
begin
  if new.status in ('delivered', 'rejected', 'cancelled')
     or new.agent_id is null
     or new.assignment_status in ('none', 'delivered', 'failed') then
    new.agent_latitude := null;
    new.agent_longitude := null;
    new.agent_location_accuracy_meters := null;
    new.agent_location_at := null;
  end if;
  return new;
end
$function$;

drop trigger if exists orders_clear_agent_location on public.orders;
create trigger orders_clear_agent_location
  before insert or update on public.orders
  for each row execute function public.clear_agent_location_on_close();
