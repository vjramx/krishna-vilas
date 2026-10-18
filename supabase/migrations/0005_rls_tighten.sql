-- 0005_rls_tighten: remove the overly-permissive issuer-only SELECT policies
-- (any verified user could read every row) — least-privilege replaces them.

drop policy if exists issuer_pin on public.admin_users;
drop policy if exists admin_users_admin_read on public.admin_users;
create policy admin_users_admin_read on public.admin_users
  for select
  using (public.is_allowed_issuer() and public.is_administrator());

drop policy if exists issuer_pin on public.agent_users;
-- agent_users keeps: agents_select_own (self), agents_admin_write (admins ALL).

drop policy if exists issuer_pin on public.profiles;
-- profiles keeps: profiles_select_own (self), profiles_update_own (self ALL).
