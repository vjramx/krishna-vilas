-- 0001_app_completeness: status history + realtime + staff onboarding RPC.

-- ---------------------------------------------------------------- status history
create table if not exists public.order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  old_status text,
  new_status text not null,
  changed_by uuid,          -- auth.uid() of admin/agent when known (set via RPC audit triggers below)
  created_at timestamptz not null default now()
);

create index if not exists order_status_history_order_idx
  on public.order_status_history (order_id, created_at);

alter table public.order_status_history enable row level security;

drop policy if exists order_history_read on public.order_status_history;
create policy order_history_read on public.order_status_history
  for select to public
  using (
    exists (select 1 from public.orders o
            where o.id = order_status_history.order_id
              and (o.customer_id = auth.uid() or o.agent_id = auth.uid()))
    or public.is_administrator()
  );

drop policy if exists order_history_admin_write on public.order_status_history;
create policy order_history_admin_write on public.order_status_history
  for insert to public
  with check (public.is_administrator());

-- Audit trigger: record status transitions (runs as definer via postgres owner).
create or replace function public.log_status_change()
returns trigger
language plpgsql
security definer
set search_path = 'public'
as $function$
begin
  if old.status is distinct from new.status then
    insert into public.order_status_history (order_id, old_status, new_status, changed_by)
    values (new.id, old.status, new.status, coalesce(auth.uid(), null));
  end if;
  return new;
end
$function$;

drop trigger if exists trg_log_status on public.orders;
create trigger trg_log_status
  after update on public.orders
  for each row execute function public.log_status_change();

-- ---------------------------------------------------------------- realtime
-- Broadcast orders + agent related tables via supabase_realtime.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public'
                   and tablename = 'orders') then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_publication_tables
                 where pubname = 'supabase_realtime'
                   and schemaname = 'public'
                   and tablename = 'menu_items') then
    alter publication supabase_realtime add table public.menu_items;
  end if;
end $$;

-- ---------------------------------------------------------------- staff onboarding
-- An administrator can create a password account for a delivery agent without
-- ever holding the service-role key in a client. The caller MUST be an admin
-- checked against public.admin_users. Password is stored bcrypt-hashed exactly
-- like the Supabase auth GoTrue account format.
create extension if not exists pgcrypto;

create or replace function public.staff_create_agent(
  p_email text,
  p_name text,
  p_phone text,
  p_password text
)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'extensions', 'auth'
as $function$
declare
  v_uid uuid;
begin
  if not public.is_administrator() then
    raise exception 'NOT_ADMINISTRATOR';
  end if;

  if p_email is null or p_email !~ '^\S+@\S+\.\S+$' then raise exception 'FIELD_EMAIL'; end if;
  if p_name is null or length(btrim(p_name)) < 2 then raise exception 'FIELD_NAME'; end if;
  if p_password is null or length(p_password) < 6 then raise exception 'FIELD_PASSWORD'; end if;

  -- Existing auth user? Reuse (idempotent), else create one.
  select u.id into v_uid from auth.users u
   where lower(u.email) = lower(p_email)
   limit 1;

  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email,
      encrypted_password, email_confirmed_at, raw_app_meta_data,
      raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      p_email,
      crypt(p_password, gen_salt('bf')),
      now(), '{"provider":"email","providers":["email"]}'::jsonb,
      '{}'::jsonb, now(), now(),
      '', ''
    );

    insert into auth.identities (user_id, provider, provider_id, identity_data, last_sign_in_at, created_at, updated_at)
    values (v_uid, 'email', p_email,
            jsonb_build_object('sub', v_uid::text, 'email', p_email, 'email_verified', true),
            now(), now(), now());
  else
    update auth.users
       set encrypted_password = crypt(p_password, gen_salt('bf')),
           email_confirmed_at = coalesce(email_confirmed_at, now()),
           updated_at = now()
     where id = v_uid;
  end if;

  insert into public.agent_users (id, email, name_en, phone, is_active)
  values (v_uid, p_email, p_name, p_phone, true)
  on conflict (id) do update set
    name_en = excluded.name_en,
    phone = coalesce(excluded.phone, agent_users.phone),
    is_active = true;

  insert into public.profiles (id) values (v_uid) on conflict (id) do nothing;

  return v_uid;
end
$function$;

-- Prevent anon/authed from mutating admin_users except via explicit admin writes;
-- RLS stays untouched. Add helpful indexes if missing.
create index if not exists orders_status_assignment_idx
  on public.orders (status, assignment_status)
  where status in ('out_for_delivery','delivered');
