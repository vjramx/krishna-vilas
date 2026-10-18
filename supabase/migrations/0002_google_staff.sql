-- 0002_google_staff: all roles now sign in with Google (OAuth). Password-based
-- staff onboarding is removed; agents/admins are granted by looking up an
-- existing, confirmed auth user, i.e. someone who has signed in with Google
-- (or otherwise confirmed email) once.

create or replace function public.staff_grant_agent(
  p_email text,
  p_name text,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'auth'
as $function$
declare
  v_uid uuid;
begin
  if not public.is_administrator() then raise exception 'NOT_ADMINISTRATOR'; end if;
  if p_email is null or p_email !~ '^\S+@\S+\.\S+$' then raise exception 'FIELD_EMAIL'; end if;

  select u.id into v_uid
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
     and u.email_confirmed_at is not null
   limit 1;

  if v_uid is null then
    raise exception 'AGENT_NOT_SIGNED_UP:%', p_email;
  end if;

  insert into public.agent_users (id, email, name_en, phone, is_active)
  values (v_uid, btrim(p_email), coalesce(btrim(p_name), split_part(p_email, '@', 1)), p_phone, true)
  on conflict (id) do update
    set name_en = excluded.name_en,
        phone = coalesce(excluded.phone, agent_users.phone),
        is_active = true;

  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  return v_uid;
end
$function$;

create or replace function public.staff_grant_admin(p_email text)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'auth'
as $function$
declare
  v_uid uuid;
begin
  if not public.is_administrator() then raise exception 'NOT_ADMINISTRATOR'; end if;
  if p_email is null or p_email !~ '^\S+@\S+\.\S+$' then raise exception 'FIELD_EMAIL'; end if;

  select u.id into v_uid
    from auth.users u
   where lower(u.email) = lower(btrim(p_email))
     and u.email_confirmed_at is not null
   limit 1;
  if v_uid is null then
    raise exception 'AGENT_NOT_SIGNED_UP:%', p_email;
  end if;

  insert into public.admin_users (id, email) values (v_uid, btrim(p_email))
  on conflict (id) do update set email = excluded.email;
  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;
  return v_uid;
end
$function$;

-- Remove password-based staff onboarding RPC (superseded by grant functions).
drop function if exists public.staff_create_agent(text, text, text, text);
-- Seeded password-only admin account is removed; the owner's Google account
-- takes over below (bootstrap script grants admin_users by email).
delete from public.admin_users where lower(email) = 'admin@krishnavilas.in';
delete from public.profiles where id in
  (select id from auth.users where lower(email) = 'admin@krishnavilas.in');
delete from auth.identities where user_id in
  (select id from auth.users where lower(email) = 'admin@krishnavilas.in');
delete from auth.users where lower(email) = 'admin@krishnavilas.in';

-- Correct a stray no-op function reference if it ever existed
drop function if exists public.p_username_check();
