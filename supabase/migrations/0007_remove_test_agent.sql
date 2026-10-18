-- 0007_remove_test_agent: delete the demo delivery agent seeded by 0003.
--
-- Migration 0003 inserted `agent@krishnavilas.in` / "Demo Agent" purely to test
-- the delivery flow (`delete from public.agent_users; insert ... Demo Agent`).
-- It is not a real staff account. Remove it, its profile and its auth user so
-- it never appears in Admin -> Agents or the staff portal.
--
-- Orders are preserved: any historical order that referenced this agent has
-- its `agent_id` cleared instead of losing the order.

update public.orders
   set agent_id = null
 where agent_id in (
   select id::text from public.agent_users where lower(email) = 'agent@krishnavilas.in'
 );

delete from public.order_status_history
 where changed_by in (
   select id from public.agent_users where lower(email) = 'agent@krishnavilas.in'
   union
   select id from auth.users where lower(email) = 'agent@krishnavilas.in'
 );

delete from public.agent_users where lower(email) = 'agent@krishnavilas.in';

delete from public.profiles
 where id in (select id::text from auth.users where lower(email) = 'agent@krishnavilas.in');

delete from auth.identities
 where user_id in (select id from auth.users where lower(email) = 'agent@krishnavilas.in');

delete from auth.users where lower(email) = 'agent@krishnavilas.in';
