-- 0021_stable_agent_completion
-- Completes the idempotency pass started in 0018/0020: a double tap (or a
-- lost realtime update followed by a re-tap) must never surface a stale state
-- error when the agent's intended outcome has already landed. Authorization,
-- ownership and attestation rules are unchanged. The delivery-agent UI drives
-- these three; legacy agent_arrived / agent_pickup / agent_reached_customer
-- are retired from the UI and intentionally left strictly validated.

create or replace function public.agent_deliver(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_actor text;
begin
  if not public.is_allowed_issuer() or not public.is_agent() then
    raise exception 'NOT_AGENT';
  end if;
  v_actor := public.kv_agent_id()::text;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found or v_order.agent_id is distinct from v_actor then
    raise exception 'NOT_ASSIGNED';
  end if;
  -- Idempotent repeat: this agent already completed this order successfully.
  if v_order.status = 'delivered' and v_order.assignment_status = 'delivered' then
    return;
  end if;
  -- Idempotency: once delivered (or any irreversible state), no further write.
  if v_order.status in ('delivered', 'rejected', 'cancelled')
     or v_order.delivered_at is not null
     or v_order.cod_collected is not null
     or v_order.assignment_status in ('delivered', 'failed') then
    raise exception 'FINAL_STATE';
  end if;
  -- Only the assigned agent, on an active assignment of a live order.
  if v_order.assignment_status not in ('accepted', 'picked_up')
     or v_order.status not in ('confirmed', 'preparing', 'ready', 'out_for_delivery') then
    raise exception 'WRONG_STATE';
  end if;
  if v_order.total is null or v_order.total < 0 then
    raise exception 'AMOUNT_INVALID';
  end if;

  update public.orders
     set status = 'delivered',
         delivered_at = now(),
         assignment_status = 'delivered',
         cod_expected = v_order.total,
         cod_collected = v_order.total,
         cash_verified_at = null
   where id = p_order_id;
end
$function$;
revoke all on function public.agent_deliver(uuid) from public, anon, authenticated;
grant execute on function public.agent_deliver(uuid) to anon, authenticated;

create or replace function public.agent_fail(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_market public.orders%rowtype;
begin
  if not public.is_agent() then raise exception 'NOT_AGENT'; end if;
  if p_reason is null or length(btrim(p_reason)) < 3 then raise exception 'REASON_REQUIRED'; end if;
  select * into v_market from public.orders where id = p_order_id for update;
  if not found or v_market.agent_id is distinct from public.kv_agent_id()::text then raise exception 'NOT_ASSIGNED'; end if;
  -- Idempotent repeat: this agent already recorded the failure.
  if v_market.assignment_status = 'failed' then
    return;
  end if;
  if v_market.assignment_status not in ('accepted','picked_up') then
    raise exception 'WRONG_STATE:%', v_market.assignment_status;
  end if;
  update public.orders set assignment_status = 'failed', delivery_fail_reason = btrim(p_reason) where id = p_order_id;
end
$function$;
revoke all on function public.agent_fail(uuid, text) from public, anon, authenticated;
grant execute on function public.agent_fail(uuid, text) to anon, authenticated;

create or replace function public.agent_hand_cash(p_order_id uuid)
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
  -- Idempotent repeat: this agent already handed the cash over.
  if v_market.cash_handed_at is not null then
    return;
  end if;
  if v_market.cod_collected is null then raise exception 'NOTHING_RECORDED'; end if;
  update public.orders set cash_handed_at = now() where id = p_order_id;
end
$function$;
revoke all on function public.agent_hand_cash(uuid) from public, anon, authenticated;
grant execute on function public.agent_hand_cash(uuid) to anon, authenticated;
