-- DEPRECATED — superseded by scripts/bootstrap-accounts.mjs which uses the supported
-- GoTrue Admin API (hand-inserted auth.users rows broke GoTrue sign-in).
-- Owner MUST change these temporary passwords immediately after first sign-in.
create extension if not exists pgcrypto;

do $$
declare
  v_id uuid;
begin
  -- ADMIN
  select u.id into v_id from auth.users u where lower(u.email) = 'admin@krishnavilas.in' limit 1;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      'admin@krishnavilas.in', crypt('kv-admin-temp-2026', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '');
    insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
    values (v_id, 'email', 'admin@krishnavilas.in',
      jsonb_build_object('sub', v_id::text, 'email', 'admin@krishnavilas.in', 'email_verified', true),
      now(), now(), now());
  end if;
  insert into public.admin_users (id, email) values (v_id, 'admin@krishnavilas.in')
    on conflict (id) do update set email = excluded.email;

  -- DEMO AGENT
  select u.id into v_id from auth.users u where lower(u.email) = 'agent@krishnavilas.in' limit 1;
  if v_id is null then
    v_id := gen_random_uuid();
    insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token)
    values ('00000000-0000-0000-0000-000000000000', v_id, 'authenticated', 'authenticated',
      'agent@krishnavilas.in', crypt('kv-agent-temp-2026', gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
      now(), now(), '', '');
    insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
    values (v_id, 'email', 'agent@krishnavilas.in',
      jsonb_build_object('sub', v_id::text, 'email', 'agent@krishnavilas.in', 'email_verified', true),
      now(), now(), now());
  end if;
  insert into public.agent_users (id, email, name_en, phone, is_active)
  values (v_id, 'agent@krishnavilas.in', 'Demo Agent', null, true)
    on conflict (id) do update set is_active = true;
end $$;
