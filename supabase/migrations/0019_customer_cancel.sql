-- 0019_customer_cancel
-- Reapply the lost customer-cancel capability: the duplicate-numbered
-- 0006_customer_cancel.sql was never applied, so the customer "Cancel" button
-- called a function that did not exist in the live database. Idempotent copy
-- of that migration's contract (columns exist already; function is recreated).

drop policy if exists customer_cancel_own on public.orders;

drop function if exists public.cancel_order(uuid);
create or replace function public.cancel_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_uid   text := public.kv_subject();
  v_order public.orders%rowtype;
begin
  if v_uid is null or v_uid = '' then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  -- Ownership enforced here, not via RLS grants: orders stay read/manager
  -- gated elsewhere; a customer row update is not surfaced through policies.
  if v_order.customer_id <> v_uid then raise exception 'NOT_ORDER_OWNER'; end if;
  -- Agent workflow already started (assigned->picked_up) must not be yanked.
  if v_order.status not in ('pending', 'confirmed') then raise exception 'CANCEL_TOO_LATE'; end if;
  update public.orders set
    status       = 'cancelled',
    cancelled_at = now(),
    cancelled_by = 'customer'
  where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', 'cancelled');
end
$function$;

revoke execute on function public.cancel_order(uuid) from anon;
grant execute on function public.cancel_order(uuid) to authenticated;
