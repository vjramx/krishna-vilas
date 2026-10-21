-- Firebase third-party-auth JWTs are verified by Supabase but map to the
-- PostgreSQL `anon` role here. These role checks and protected staff RPCs need
-- anon execute grants, with authorization enforced by the verified issuer and
-- Super Admin email inside the database functions themselves.

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $function$
  select public.is_allowed_issuer() and exists (
    select 1 from public.admin_users a
    where lower(a.email) = public.kv_email() and a.email <> ''
  )
$function$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $function$
  select public.is_allowed_issuer() and exists (
    select 1 from public.admin_users a
    where lower(a.email) = public.kv_email()
      and a.email <> ''
      and a.role = 'super_admin'
  )
$function$;

create or replace function public.kv_resolve_admin_invitation(p_email text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_rec public.admin_invitations%rowtype;
begin
  -- The helper is private, and still validates its argument defensively so it
  -- cannot be misused if a future definer function calls it incorrectly.
  if coalesce(p_email, '') = ''
     or lower(btrim(p_email)) <> public.kv_email()
     or not public.is_allowed_issuer() then
    raise exception 'AUTH_REQUIRED';
  end if;

  update public.admin_invitations
     set status = 'expired'
   where lower(email) = public.kv_email()
     and status = 'pending'
     and expires_at < now();

  select * into v_rec
    from public.admin_invitations
   where lower(email) = public.kv_email()
     and status = 'pending'
     and expires_at >= now()
   order by created_at desc
   limit 1
   for update;

  if v_rec.id is not null then
    insert into public.admin_users (id, email, role)
    values (gen_random_uuid(), v_rec.email, v_rec.role)
    on conflict (email) do update set role = excluded.role;
    if not exists (
      select 1 from public.admin_users where lower(email) = public.kv_email()
    ) then
      raise exception 'ADMIN_INVITATION_CONFLICT';
    end if;
    update public.admin_invitations
       set status = 'accepted', accepted_at = now()
     where id = v_rec.id;
    insert into public.audit_log (actor_email, action, target_type, target_id, details)
    values (public.kv_email(), 'admin.invitation.accepted', 'admin_invitation', v_rec.id::text,
            jsonb_build_object('role', v_rec.role));
  end if;
end
$function$;

create or replace function public.is_current_admin()
returns boolean
language plpgsql
volatile
security definer
set search_path = 'public'
as $function$
begin
  if not public.is_allowed_issuer() then return false; end if;
  perform public.kv_resolve_admin_invitation(public.kv_email());
  return public.is_administrator();
end
$function$;

create or replace function public.is_current_super_admin()
returns boolean
language sql
stable
security definer
set search_path = 'public'
as $function$
  select public.is_allowed_issuer() and public.is_super_admin()
$function$;

-- All management RPCs check is_super_admin() before changing state. It now
-- checks the verified issuer too, so the legacy function bodies are protected.
revoke execute on function public.is_super_admin()
  from public, anon, authenticated;
revoke execute on function public.is_administrator()
  from public, anon, authenticated;
grant execute on function public.is_administrator()
  to anon, authenticated;

revoke execute on function public.is_current_admin()
  from public, anon, authenticated;
grant execute on function public.is_current_admin()
  to anon, authenticated;
revoke execute on function public.is_current_super_admin()
  from public, anon, authenticated;
grant execute on function public.is_current_super_admin()
  to anon, authenticated;

revoke execute on function public.staff_invite_admin(text, text)
  from public, anon, authenticated;
grant execute on function public.staff_invite_admin(text, text)
  to anon, authenticated;
revoke execute on function public.staff_revoke_invitation(uuid)
  from public, anon, authenticated;
grant execute on function public.staff_revoke_invitation(uuid)
  to anon, authenticated;
revoke execute on function public.staff_remove_admin(text)
  from public, anon, authenticated;
grant execute on function public.staff_remove_admin(text)
  to anon, authenticated;
revoke execute on function public.staff_grant_admin(text)
  from public, anon, authenticated;
grant execute on function public.staff_grant_admin(text)
  to anon, authenticated;

-- Selects are still filtered by the existing RLS policies. Admins can see the
-- role/invitation list; non-admin customers cannot read either table.
grant select on public.admin_users, public.admin_invitations
  to anon, authenticated;

-- Never expose the email-parameterized resolver: only is_current_admin() may
-- invoke it with the verified caller email claim.
revoke execute on function public.kv_resolve_admin_invitation(text)
  from public, anon, authenticated;

-- kv_audit has no caller authorization contract; protected definer RPCs invoke
-- it internally as their owner, so clients do not need direct execute rights.
revoke execute on function public.kv_audit(text, text, text, jsonb)
  from public, anon, authenticated;

notify pgrst, 'reload schema';
