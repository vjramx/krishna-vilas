-- 0018_stable_transitions
-- Operators tapping an action twice (or after a lost realtime update) were told
-- "status change not allowed" even though their intended change had already
-- succeeded. Transitions become idempotent repeats: re-asserting the current
-- live state is a success no-op, never an error. Security hardening from 0016
-- (is_allowed_issuer + is_administrator) and the confirm-time auto-dispatch
-- from 0013 are both preserved. Delivery completion stays exclusive to
-- agent_deliver / admin_mark_delivered (0016/0017) — set_order_status never
-- writes a status of 'delivered'.

create or replace function public.set_order_status(p_order_id uuid, p_new_status text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_order public.orders%rowtype;
begin
  if not public.is_allowed_issuer() or not public.is_administrator() then
    raise exception 'NOT_ADMINISTRATOR';
  end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  -- Idempotent repeat: re-clicking an action whose change already landed is a
  -- success no-op for any live kitchen/courier state…
  if v_order.status = p_new_status and v_order.status in ('confirmed', 'preparing', 'ready', 'out_for_delivery') then
    return jsonb_build_object('order_id', p_order_id, 'status', v_order.status);
  end if;
  -- …and a terminal state (including re-cancelling/re-delivering) stays final.
  if v_order.status in ('delivered', 'rejected', 'cancelled') then
    raise exception 'FINAL_STATE';
  end if;
  if not (
    (v_order.status = 'pending' and p_new_status in ('confirmed', 'rejected')) or
    (v_order.status = 'confirmed' and p_new_status in ('preparing', 'rejected')) or
    (v_order.status = 'preparing' and p_new_status = 'ready') or
    (v_order.status = 'ready' and p_new_status = 'out_for_delivery')
  ) then
    raise exception 'INVALID_TRANSITION:%->%', v_order.status, p_new_status;
  end if;
  update public.orders set
    status = p_new_status,
    confirmed_at        = case when p_new_status = 'confirmed'        then now() else confirmed_at end,
    preparing_at        = case when p_new_status = 'preparing'        then now() else preparing_at end,
    ready_at            = case when p_new_status = 'ready'            then now() else ready_at end,
    out_for_delivery_at = case when p_new_status = 'out_for_delivery' then now() else out_for_delivery_at end,
    rejected_at         = case when p_new_status = 'rejected'         then now() else rejected_at end,
    reject_reason       = case when p_new_status = 'rejected'         then coalesce(p_note, '') else reject_reason end,
    delay_note          = p_note
  where id = p_order_id;

  -- Auto-dispatch on accept: hand the order to the least-loaded active agent
  -- (preserved from migration 0013).
  if p_new_status = 'confirmed' and v_order.agent_id is null then
    declare
      v_auto_agent text := public.pick_auto_assign_agent();
    begin
      if v_auto_agent is not null then
        update public.orders
           set agent_id = v_auto_agent,
               assignment_status = 'assigned',
               accepted_at = null,
               arrived_at = null,
               picked_up_at = null
         where id = p_order_id;
      end if;
    end;
  end if;
  return jsonb_build_object('order_id', p_order_id, 'status', p_new_status);
end
$function$;
revoke all on function public.set_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_order_status(uuid, text, text) to anon, authenticated;

-- Agentiding: accepting twice (double tap / lost realtime) previously raised
-- WRONG_STATE. An already-accepted (or already-picked-up) order re-accepts as a
-- silent success; a declined/failed assignment stays a hard error so a stale
-- screen cannot resurrect a handoff that was given back.
create or replace function public.agent_accept(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  -- Idempotent repeat: the agent already accepted this assignment.
  if v_market.assignment_status in ('accepted', 'picked_up') then
    return;
  end if;
  if v_market.assignment_status <> 'assigned' then raise exception 'WRONG_STATE:%', v_market.assignment_status; end if;
  update public.orders set assignment_status = 'accepted', accepted_at = now() where id = p_order_id;
end
$function$;
revoke all on function public.agent_accept(uuid) from public, anon, authenticated;
grant execute on function public.agent_accept(uuid) to anon, authenticated;
