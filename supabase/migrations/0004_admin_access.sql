-- 0004_admin_access: trusted super-admin bootstrap, invitations, and audit log.
--
-- Identity model (unchanged): the verified Firebase JWT `email` claim authorizes
-- staff; admin_users/agent_users rows are matched by case-insensitive email.
--
-- What this adds:
--   1. admin_users.role ('super_admin' | 'admin') + idempotent bootstrap insert
--      for the owner vijayramv229@gmail.com (migration-time, server-side; no
--      frontend can grant this row).
--   2. admin_invitations: pending/accepted/revoked/expired lifecycle created by
--      the super admin only; a pending invitation matching a verified sign-in
--      email is auto-accepted at the trusted is_current_admin() check.
--   3. audit_log: append-only (RLS: admins read, nobody direct-writes);
--      populated by security-definer helpers and capture triggers.

-- ----------------------------------------------------------------- roles
-- (column first: SQL function bodies are validated against existing columns)
alter table public.admin_users
  add column if not exists role text not null default 'admin'
  check (role in ('super_admin', 'admin'));

-- ---------------------------------------------------------------- helpers
create or replace function public.is_super_admin()
returns boolean
language sql
stable
set search_path = 'public'
as $function$
  select exists (
    select 1 from public.admin_users a
    where lower(a.email) = public.kv_email()
      and a.email <> ''
      and a.role = 'super_admin'
  )
$function$;

-- Bootstrap (idempotent, migration-side only): the verified owner account
-- becomes the initial super administrator without needing a Supabase auth row.
insert into public.admin_users (id, email, role)
select gen_random_uuid(), 'vijayramv229@gmail.com', 'super_admin'
where not exists (
  select 1 from public.admin_users where lower(email) = 'vijayramv229@gmail.com'
);
update public.admin_users
   set role = 'super_admin'
 where lower(email) = 'vijayramv229@gmail.com'
   and coalesce(role, '') <> 'super_admin';

-- ------------------------------------------------------------ invitations
create table if not exists public.admin_invitations (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  role        text not null default 'admin' check (role in ('super_admin', 'admin')),
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'revoked', 'expired')),
  invited_by  text not null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz
);
create unique index if not exists admin_invitations_one_pending
  on public.admin_invitations (lower(email)) where status = 'pending';
create index if not exists admin_invitations_email_idx
  on public.admin_invitations (lower(email), status);

alter table public.admin_invitations enable row level security;

drop policy if exists admin_invitations_admin_read on public.admin_invitations;
create policy admin_invitations_admin_read on public.admin_invitations
  for select
  using (public.is_allowed_issuer() and public.is_administrator());

-- ------------------------------------------------------------ audit log
create table if not exists public.audit_log (
  id          uuid primary key default gen_random_uuid(),
  actor_uid   text,
  actor_email text,
  action      text not null,
  target_type text,
  target_id   text,
  details     jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log (created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action);

alter table public.audit_log enable row level security;

drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select
  using (public.is_allowed_issuer() and public.is_administrator());
-- No insert/update/delete policies: direct writes are impossible; only the
-- owner-owned security-definer helpers below may write rows.

create or replace function public.kv_audit(
  p_action text,
  p_target_type text default null,
  p_target_id text default null,
  p_details jsonb default null
)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  insert into public.audit_log (actor_uid, actor_email, action, target_type, target_id, details)
  values (public.kv_subject(), public.kv_email(), p_action, p_target_type, p_target_id, p_details);
end
$function$;

revoke execute on function public.kv_audit(text, text, text, jsonb) from anon, authenticated;
grant execute on function public.kv_audit(text, text, text, jsonb) to authenticated;

-- ------------------------------------------------- invitation management
create or replace function public.staff_invite_admin(p_email text, p_role text default 'admin')
returns uuid
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_email text;
  v_role text;
  v_id uuid;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  v_role := coalesce(p_role, 'admin');
  if v_email !~ '^\S+@\S+\.\S+$' then raise exception 'FIELD_EMAIL'; end if;
  if v_role not in ('admin', 'super_admin') then raise exception 'FIELD_ROLE'; end if;
  if v_email = public.kv_email() then raise exception 'CANNOT_INVITE_SELF'; end if;
  if exists (select 1 from public.admin_users where lower(email) = v_email)
    then raise exception 'ALREADY_ADMIN'; end if;

  select i.id into v_id from public.admin_invitations i
   where lower(i.email) = v_email and i.status = 'pending'
   for update;
  if v_id is not null then
    update public.admin_invitations
       set role = v_role, expires_at = now() + interval '7 days', invited_by = public.kv_email()
     where id = v_id;
  else
    insert into public.admin_invitations (email, role, invited_by)
    values (v_email, v_role, public.kv_email())
    returning id into v_id;
  end if;

  perform public.kv_audit('admin.invitation.created', 'admin_invitation', v_id::text,
    jsonb_build_object('email', v_email, 'role', v_role));
  return v_id;
end
$function$;

create or replace function public.staff_revoke_invitation(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $function$
declare v boolean;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  update public.admin_invitations
     set status = 'revoked'
   where id = p_id and status = 'pending'
   returning true into v;
  if v is true then
    perform public.kv_audit('admin.invitation.revoked', 'admin_invitation', p_id::text, null);
  end if;
  return coalesce(v, false);
end
$function$;

-- Removes an accepted admin's access (effect immediately on backend checks).
create or replace function public.staff_remove_admin(p_email text)
returns boolean
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_email text;
  v_role text;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  v_email := lower(btrim(coalesce(p_email, '')));
  if v_email = public.kv_email() then raise exception 'CANNOT_REMOVE_SELF'; end if;
  select role into v_role from public.admin_users where lower(email) = v_email limit 1;
  if v_role is null then return false; end if;
  if v_role = 'super_admin' then raise exception 'CANNOT_REMOVE_SUPER_ADMIN'; end if;
  delete from public.admin_users where lower(email) = v_email;
  perform public.kv_audit('admin.access.removed', 'admin_user', v_email, null);
  return true;
end
$function$;

revoke execute on function public.staff_invite_admin(text, text) from anon, authenticated;
revoke execute on function public.staff_revoke_invitation(uuid) from anon, authenticated;
revoke execute on function public.staff_remove_admin(text) from anon, authenticated;
grant execute on function public.staff_invite_admin(text, text) to authenticated;
grant execute on function public.staff_revoke_invitation(uuid) to authenticated;
grant execute on function public.staff_remove_admin(text) to authenticated;

-- Tightened: only the super admin grants the admin role directly.
create or replace function public.staff_grant_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'auth'
as $function$
declare
  v_uid uuid;
begin
  if not public.is_super_admin() then raise exception 'NOT_SUPER_ADMIN'; end if;
  if p_email is null or p_email !~ '^\S+@\S+\.\S+$' then raise exception 'FIELD_EMAIL'; end if;

  select u.id into v_uid
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
     and u.email_confirmed_at is not null
   limit 1;
  if v_uid is null then
    raise exception 'AGENT_NOT_SIGNED_UP:%', p_email;
  end if;

  insert into public.admin_users (id, email, role) values (v_uid, btrim(p_email), 'admin')
  on conflict (id) do update set email = excluded.email;
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  perform public.kv_audit('admin.access.granted', 'admin_user', lower(btrim(p_email)), null);
  return v_uid;
end
$function$;

revoke execute on function public.staff_grant_admin(text) from anon, authenticated;
grant execute on function public.staff_grant_admin(text) to authenticated;

-- ------------------------------------- invitation acceptance (trusted path)
-- Called inside is_current_admin(): a pending, unexpired invitation matching the
-- caller's verified JWT email is accepted server-side; the caller can never
-- resolve someone else's email. Expired pending invitations are marked expired.
create or replace function public.kv_resolve_admin_invitation(p_email text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_rec public.admin_invitations%rowtype;
begin
  if coalesce(p_email, '') = '' then return; end if;

  update public.admin_invitations
     set status = 'expired'
   where lower(email) = p_email and status = 'pending' and expires_at < now();

  select * into v_rec
    from public.admin_invitations
   where lower(email) = p_email and status = 'pending' and expires_at >= now()
   order by created_at desc
   limit 1;

  if v_rec.id is not null then
    insert into public.admin_users (id, email, role)
    values (gen_random_uuid(), v_rec.email, v_rec.role)
    on conflict do nothing;
    update public.admin_invitations
       set status = 'accepted', accepted_at = now()
     where id = v_rec.id;
    insert into public.audit_log (actor_email, action, target_type, target_id, details)
    values (p_email, 'admin.invitation.accepted', 'admin_invitation', v_rec.id::text,
            jsonb_build_object('role', v_rec.role));
  end if;
end
$function$;

revoke execute on function public.kv_resolve_admin_invitation(text) from anon, authenticated;
grant execute on function public.kv_resolve_admin_invitation(text) to authenticated;

drop function if exists public.is_current_admin();
create or replace function public.is_current_admin()
returns boolean
language plpgsql
volatile
security definer
set search_path = 'public'
as $function$
begin
  perform public.kv_resolve_admin_invitation(public.kv_email());
  return public.is_administrator();
end
$function$;

revoke execute on function public.is_current_admin() from anon;
grant execute on function public.is_current_admin() to authenticated;

-- Super-admin flag for UI gating (backend still enforces everything).
create or replace function public.is_current_super_admin()
returns boolean
language sql
stable
set search_path = 'public'
as $function$
  select public.is_super_admin()
$function$;

revoke execute on function public.is_current_super_admin() from anon;
grant execute on function public.is_current_super_admin() to authenticated;

-- ------------------------------------------------------------ audit triggers
-- Sensitive-value exclusions: never log delivery PINs or auth material.
create or replace function public.kv_audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_actor text;
  v_old jsonb;
  v_new jsonb;
  v_changed jsonb := '{}'::jsonb;
  v_excluded text[] := array['delivery_pin', 'image_path', 'logo_path', 'banner_image_path'];
begin
  v_actor := public.kv_email();
  if TG_OP = 'UPDATE' then
    v_old := to_jsonb(OLD);
    v_new := to_jsonb(NEW);
    select coalesce(jsonb_object_agg(k, v_new -> k), '{}'::jsonb)
      into v_changed
      from jsonb_object_keys(v_new) as k
     where k in ('price', 'original_price', 'is_available', 'is_active', 'is_featured',
                 'name_en', 'name_kn', 'is_accepting_orders', 'delivery_fee',
                 'min_order_total', 'opens_at', 'closes_at')
       and k not in (select unnest(v_excluded))
       and (v_old -> k) is distinct from (v_new -> k);
    if v_changed = '{}'::jsonb then return null; end if;
  elsif TG_OP = 'INSERT' then
    v_new := to_jsonb(NEW);
    v_changed := v_new - (select array_agg(x) from unnest(v_excluded) as x);
  elsif TG_OP = 'DELETE' then
    v_old := to_jsonb(OLD);
    v_changed := v_old - (select array_agg(x) from unnest(v_excluded) as x);
  end if;
  insert into public.audit_log (actor_email, action, target_type, target_id, details)
  values (
    v_actor, 'kv.' || TG_TABLE_NAME || '.' || lower(TG_OP), TG_TABLE_NAME,
    coalesce(v_new ->> 'id', v_old ->> 'id'), v_changed
  );
  return null;
end
$function$;

revoke execute on function public.kv_audit_row_change() from anon, authenticated;

drop trigger if exists menu_items_audit on public.menu_items;
drop trigger if exists hotel_settings_audit on public.hotel_settings;
drop trigger if exists admin_users_audit on public.admin_users;
drop trigger if exists admin_invitations_audit on public.admin_invitations;

create trigger menu_items_audit after insert or update or delete on public.menu_items
  for each row execute function public.kv_audit_row_change();
create trigger hotel_settings_audit after update on public.hotel_settings
  for each row execute function public.kv_audit_row_change();
create trigger admin_users_audit after insert or delete on public.admin_users
  for each row execute function public.kv_audit_row_change();
create trigger admin_invitations_audit after insert or update or delete on public.admin_invitations
  for each row execute function public.kv_audit_row_change();
