-- 0020_stable_agent_decline
-- Declining twice (double tap / lost realtime) raised WRONG_STATE even though
-- the intended outcome had already happened. A re-decline of an assignment the
-- agent already gave back is a silent success; anything else stays a hard
-- error so a stale screen cannot drop someone else's live assignment.

create or replace function public.agent_decline(p_order_id uuid)
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
  -- Idempotent repeat: this agent already gave the assignment back.
  if v_market.agent_id is null and v_market.assignment_status = 'none' then
    return;
  end if;
  if v_market.assignment_status <> 'assigned' then raise exception 'WRONG_STATE:%', v_market.assignment_status; end if;
  update public.orders set agent_id = null, assignment_status = 'none' where id = p_order_id;
end
$function$;
revoke all on function public.agent_decline(uuid) from public, anon, authenticated;
grant execute on function public.agent_decline(uuid) to anon, authenticated;
