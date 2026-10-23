-- 0025_fulfillment_mode
--
-- Two ways to run delivery, switchable from Admin → Settings:
--   • 'agent' (default) — the current model: delivery agents sign in and
--     deliver; every accepted order auto-dispatches to the least-loaded
--     active agent (0013/0022).
--   • 'self'            — the owner delivers every order themselves. Nobody
--     is dispatched; the admin drives the order chain (confirm → preparing →
--     ready → out_for_delivery → delivered via admin_mark_delivered) and the
--     customer's address + phone are always visible on the orders dashboard
--     for the owner's own delivery run.
--
-- The Agents management section is hidden in the admin UI while 'self' is on
-- (AdminLayout/AdminAgents/AdminOrders), and pick_auto_assign_agent() refuses
-- to hand out work below, so even the confirm RPCs cannot assign anyone.

alter table public.hotel_settings
  add column if not exists fulfillment_mode text not null default 'agent';

alter table public.hotel_settings
  drop constraint if exists hotel_settings_fulfillment_mode_check;

alter table public.hotel_settings
  add constraint hotel_settings_fulfillment_mode_check
  check (fulfillment_mode in ('agent', 'self'));

comment on column public.hotel_settings.fulfillment_mode is
  'How orders reach the customer: ''agent'' = dispatch to delivery agents, ''self'' = the owner delivers themselves (auto-dispatch disabled, agents section hidden in admin).';

-- Same least-loaded rule (0013), but it returns nothing while self delivery
-- is on — this is the single choke point every dispatch path goes through
-- (admin_confirm_order 0022, set_order_status 0013/0018), so flipping the
-- mode instantly disables auto-assignment everywhere.
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
    and (select hs.fulfillment_mode
         from public.hotel_settings hs
         where hs.id = 1) = 'agent'
  group by a.id
  order by count(o.id) asc, a.id asc
  limit 1
$$;

revoke all on function public.pick_auto_assign_agent() from public;
grant execute on function public.pick_auto_assign_agent() to anon, authenticated;
