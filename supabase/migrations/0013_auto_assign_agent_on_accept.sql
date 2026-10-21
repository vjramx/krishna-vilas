-- 0013_auto_assign_agent_on_accept
--
-- Dispatch rule (Swiggy/Zomato style): the moment an admin ACCEPTS a pending
-- order, it must land with a delivery agent automatically — no extra click.
-- The agent screen then shows the customer's name, tap-to-call phone and the
-- exact delivery pin with one-tap Google Maps navigation (already built in
-- OrderDestination + agent sheets).
--
-- Policy: choose the least-loaded ACTIVE agent (fewest in-flight assignments,
-- stable tiebreak by id). If no active agent exists, the accept still succeeds
-- and the admin can assign manually — auto-assign never blocks an order.
-- Manual assignment from the admin sheet keeps working as an override.

create or replace function public.pick_auto_assign_agent()
returns text
language sql
stable
set search_path = 'public'
as $$
  select a.id::text
  from public.agent_users a
  left join public.orders o
    on o.agent_id = a.id::text
   and o.assignment_status in ('assigned', 'accepted', 'picked_up')
  where a.is_active
  group by a.id
  order by count(o.id) asc, a.id asc
  limit 1
$$;

revoke all on function public.pick_auto_assign_agent() from public;
grant execute on function public.pick_auto_assign_agent() to anon, authenticated;

create or replace function public.set_order_status(p_order_id uuid, p_new_status text, p_note text DEFAULT NULL::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_auto_agent text;
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
  -- Auto-dispatch: on accept, hand the order to the least-loaded active agent.
  if p_new_status = 'confirmed' and v_order.agent_id is null then
    v_auto_agent := public.pick_auto_assign_agent();
    if v_auto_agent is not null then
      update public.orders
         set agent_id = v_auto_agent,
             assignment_status = 'assigned',
             accepted_at = null,
             arrived_at = null,
             picked_up_at = null
       where id = p_order_id;
    end if;
  end if;
  return jsonb_build_object('order_id', p_order_id, 'status', p_new_status);
end
$function$;
