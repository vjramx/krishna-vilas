-- 0015_agent_reached_customer: explicit "reached customer" step for delivery agents.
--
-- Agent flow after this migration:
--   assigned -> accepted -> (arrived at restaurant) -> picked_up (food collected)
--   -> reached customer -> delivered (customer PIN + cash collected)
--
-- agent_reached_customer only records the moment the agent arrives at the
-- customer's door. Delivery still requires the PIN and the cash amount through
-- agent_deliver, so this step does not complete the order.

alter table public.orders
  add column if not exists customer_reached_at timestamptz;

create or replace function public.agent_reached_customer(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  if v_market.assignment_status <> 'picked_up' or v_market.status <> 'out_for_delivery' then
    raise exception 'WRONG_STATE:%', v_market.assignment_status;
  end if;
  if v_market.customer_reached_at is not null then raise exception 'ALREADY_REACHED'; end if;
  update public.orders set customer_reached_at = now() where id = p_order_id;
end
$function$;

revoke all on function public.agent_reached_customer(uuid) from public;
-- Same grant reasoning as the other agent RPCs: staff tokens run as `anon`,
-- so the in-function NOT_AGENT / NOT_ASSIGNED checks are the real gate.
grant execute on function public.agent_reached_customer(uuid) to anon, authenticated;
