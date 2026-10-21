-- 0016_secure_order_management
-- Safe operational RPCs. Existing orders/menu items are never removed by this migration.

-- Explicitly revoke prior broad grants before granting a narrowly scoped API.
create or replace function public.admin_delete_all_orders(p_confirmation text)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_deleted integer;
begin
  if not public.is_allowed_issuer() or not public.is_administrator() then
    raise exception 'NOT_ADMINISTRATOR';
  end if;
  if p_confirmation is distinct from 'DELETE ALL ORDERS' then
    raise exception 'CONFIRMATION_REQUIRED';
  end if;

  -- Log before deletion without copying customer or order details into audit.
  insert into public.audit_log (actor_uid, actor_email, action, target_type, target_id, details)
  values (
    public.kv_subject(),
    public.kv_email(),
    'orders.bulk_delete',
    'orders',
    null,
    jsonb_build_object('requested_at', now())
  );

  -- Delete dependent records in the same transaction, including for databases
  -- where the historical foreign keys were not created with ON DELETE CASCADE.
  delete from public.order_items where order_id in (select id from public.orders);
  delete from public.order_status_history where order_id in (select id from public.orders);
  delete from public.orders;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end
$function$;
revoke all on function public.admin_delete_all_orders(text) from public, anon, authenticated;
grant execute on function public.admin_delete_all_orders(text) to anon, authenticated;

create or replace function public.admin_search_orders(p_query text)
returns setof public.orders
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_query text := btrim(coalesce(p_query, ''));
begin
  if not public.is_allowed_issuer() or not public.is_administrator() then
    raise exception 'NOT_ADMINISTRATOR';
  end if;
  if length(v_query) < 2 then
    raise exception 'SEARCH_QUERY_TOO_SHORT';
  end if;
  return query
    select o.*
      from public.orders o
     where lower(o.order_number) like '%' || lower(v_query) || '%'
        or regexp_replace(o.phone, '\\D', '', 'g') like '%' || regexp_replace(v_query, '\\D', '', 'g') || '%'
        or lower(o.customer_name) like '%' || lower(v_query) || '%'
     order by o.created_at desc
     limit 50;
end
$function$;
revoke all on function public.admin_search_orders(text) from public, anon, authenticated;
grant execute on function public.admin_search_orders(text) to anon, authenticated;

-- Delivering is a single authorized, idempotent completion step confirmed by
-- the agent with two explicit attestations (food handed over + full COD
-- collected). The customer-facing PIN dialog is retired: the attestation
-- checkboxes plus row-level agent authorization gate the action. Repeat calls
-- cannot duplicate the delivery record: a second call raises FINAL_STATE and
-- leaves the database untouched.
--
-- COD: full collection is recorded (cod_collected = cod_expected = total).
-- cash_handed_at stays NULL until the agent hands the cash to the restaurant
-- (agent_hand_cash), and cash_verified_at stays NULL until reconciled. COD is
-- therefore never marked "paid/verified" merely by accepting or dispatching.
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
-- Retire the obsolete PIN-based signature owned by earlier migrations.
drop function if exists public.agent_deliver(uuid, text, numeric);

-- Admin can manually mark an order delivered only after the operational state
-- is dispatched and collection was recorded by the agent RPC above. The UI no
-- longer invokes this transition; retain strict validation for old clients.
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
    confirmed_at = case when p_new_status = 'confirmed' then now() else confirmed_at end,
    preparing_at = case when p_new_status = 'preparing' then now() else preparing_at end,
    ready_at = case when p_new_status = 'ready' then now() else ready_at end,
    out_for_delivery_at = case when p_new_status = 'out_for_delivery' then now() else out_for_delivery_at end,
    rejected_at = case when p_new_status = 'rejected' then now() else rejected_at end,
    reject_reason = case when p_new_status = 'rejected' then coalesce(p_note, '') else reject_reason end
  where id = p_order_id;
  return jsonb_build_object('order_id', p_order_id, 'status', p_new_status);
end
$function$;
revoke all on function public.set_order_status(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_order_status(uuid, text, text) to anon, authenticated;
