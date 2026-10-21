-- 0017_admin_delivered
-- Admin-side completion step. 0016 moved delivery out of set_order_status
-- (agent_deliver is the attested path), which left out_for_delivery orders in a
-- dead end for operators when no agent device could complete the courier flow
-- (agent unassigned mid-delivery, agent away, manual support). This RPC
-- restores a working admin button without weakening set_order_status.

create or replace function public.admin_mark_delivered(p_order_id uuid)
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
  -- Idempotent terminal rule, matching agent_deliver and set_order_status:
  -- once delivered (or any irreversible state) no further write happens.
  if v_order.status in ('delivered', 'rejected', 'cancelled')
     or v_order.delivered_at is not null
     or v_order.assignment_status in ('delivered', 'failed') then
    raise exception 'FINAL_STATE';
  end if;
  -- Rejected/cancelled orders can never be "completed"; live kitchen states may.
  if v_order.status not in ('confirmed', 'preparing', 'ready', 'out_for_delivery') then
    raise exception 'WRONG_STATE';
  end if;

  update public.orders
     set status = 'delivered',
         delivered_at = now(),
         assignment_status = 'delivered',
         -- COD app-wide: admin attests full collection on manual completion,
         -- same policy as agent_deliver. Existing records are preserved.
         cod_expected = coalesce(v_order.cod_expected, v_order.total),
         cod_collected = coalesce(v_order.cod_collected, v_order.total)
   where id = p_order_id;

  return jsonb_build_object('order_id', p_order_id, 'status', 'delivered');
end
$function$;
revoke all on function public.admin_mark_delivered(uuid) from public, anon, authenticated;
grant execute on function public.admin_mark_delivered(uuid) to anon, authenticated;
