-- 0022_atomic_confirm_assignment
-- Issue 2 (Step C) + Issue 3 + Issue 9: a one-shot, admin-gated, atomic
-- confirm step. When the operator submits an ETA, the backend — in a single
-- transaction — validates authorization and the ETA, locks the order row,
-- transitions pending → confirmed, stamps the ETA and the confirmation
-- timestamp, and auto-dispatches to the least-loaded active agent (the exact
-- rule already shipped in 0013). The caller receives the post-write facts
-- (status, eta_minutes, agent_id, assignment_status), so the UI never has to
-- treat a frontend-only change as proof of confirmation.
--
-- Idempotency: re-submitting for an already-confirmed order simply refreshes
-- the ETA (and re-runs safe auto-assign when the order is still unassigned) —
-- a double tap or a retry after a network hiccup can never corrupt state.
--
-- Backward-compatible: nothing is dropped or renamed. The legacy
-- set_order_status / set_order_eta RPCs keep working with their existing
-- contracts; only this new function changes the operator's confirm path.

alter table public.orders add column if not exists assigned_at timestamptz;

-- The agent dashboard queries `orders where agent_id = <uid>` on every visit;
-- agent_id is the join key for all assignment paths. (Query pattern justified
-- index, additive and harmless.)
create index if not exists orders_agent_id_idx on public.orders (agent_id);

create or replace function public.admin_confirm_order(p_order_id uuid, p_eta_minutes integer)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_order public.orders%rowtype;
  v_auto_agent text;
begin
  if not public.is_allowed_issuer() or not public.is_administrator() then
    raise exception 'NOT_ADMINISTRATOR';
  end if;
  if p_eta_minutes is null or p_eta_minutes < 1 or p_eta_minutes > 600 then
    raise exception 'ETA_INVALID';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if v_order.status in ('delivered', 'rejected', 'cancelled') then
    raise exception 'FINAL_STATE';
  end if;
  if v_order.status not in ('pending', 'confirmed') then
    raise exception 'INVALID_TRANSITION:%->%confirmed', v_order.status, '';
  end if;

  update public.orders set
    status        = 'confirmed',
    eta_minutes   = p_eta_minutes,
    confirmed_at  = case when v_order.status = 'pending' then now() else v_order.confirmed_at end,
    eta_updated_at = now()
  where id = p_order_id;

  -- Auto-dispatch (0013 rule, safe to re-run): only ever hands the order to
  -- one agent — agent_id is a single column, so "same order to two agents"
  -- cannot happen even under concurrent admins (the row lock serializes).
  v_auto_agent := null;
  select agent_id into v_auto_agent from public.orders where id = p_order_id;
  if v_auto_agent is null then
    v_auto_agent := public.pick_auto_assign_agent();
    if v_auto_agent is not null then
      update public.orders
         set agent_id = v_auto_agent,
             assignment_status = 'assigned',
             assigned_at = now(),
             accepted_at = null,
             arrived_at = null,
             picked_up_at = null
       where id = p_order_id
         and agent_id is null; -- guard: never overwrite an existing assignment
    end if;
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'status', 'confirmed',
    'eta_minutes', p_eta_minutes,
    'agent_id', (select agent_id from public.orders where id = p_order_id),
    'assignment_status', (select assignment_status from public.orders where id = p_order_id)
  );
end
$function$;
revoke all on function public.admin_confirm_order(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_confirm_order(uuid, integer) to anon, authenticated;
