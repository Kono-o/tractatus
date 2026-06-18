-- Tractatus Supabase Setup (Username-based Auth + Identicons)
-- Run this in Supabase SQL Editor (or via CLI) for the new project.

-- ============================================
-- 1. Usernames table (core of the auth system)
-- ============================================
create table if not exists public.usernames (
  username text primary key,
  user_id uuid not null unique references auth.users (id) on delete cascade,
  avatar_seed text,
  created_at timestamptz not null default now(),
  constraint usernames_format check (username ~ '^[a-z0-9_-]{3,24}$')
);

alter table public.usernames enable row level security;

-- ============================================
-- 2. Helper functions (security definer so they can be called safely)
-- ============================================

create or replace function public.is_username_available(p_username text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  u text := lower(trim(p_username));
begin
  if u is null or u = '' or u !~ '^[a-z0-9_-]{3,24}$' then
    return false;
  end if;
  return not exists (select 1 from public.usernames where username = u);
end;
$$;

revoke all on function public.is_username_available(text) from public;
grant execute on function public.is_username_available(text) to anon, authenticated;

create or replace function public.register_username(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  u text := lower(trim(p_username));
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if u is null or u = '' or u !~ '^[a-z0-9_-]{3,24}$' then
    raise exception 'Invalid username';
  end if;
  begin
    insert into public.usernames (username, user_id) values (u, uid);
  exception
    when unique_violation then
      if exists (select 1 from public.usernames where username = u and user_id = uid) then
        return;
      end if;
      raise exception 'Username already taken' using errcode = '23505';
  end;
end;
$$;

revoke all on function public.register_username(text) from public;
grant execute on function public.register_username(text) to authenticated;

create or replace function public.rename_username(p_new_username text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
  u text := lower(trim(p_new_username));
  old_u text;
  v_seed text;
  v_url text;
  new_email text;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  if u is null or u = '' or u !~ '^[a-z0-9_-]{3,24}$' then
    raise exception 'Invalid username';
  end if;

  select username, avatar_seed, avatar_url into old_u, v_seed, v_url
  from public.usernames
  where user_id = uid
  order by username
  limit 1;

  if old_u is not null and old_u = u then
    return;
  end if;

  if exists (select 1 from public.usernames where username = u and user_id <> uid) then
    raise exception 'Username already taken' using errcode = '23505';
  end if;

  new_email := 'tr_' || u || '@example.com';

  delete from public.usernames where user_id = uid;

  insert into public.usernames (username, user_id, avatar_seed, avatar_url) values (u, uid, v_seed, v_url);

  update auth.users set
    email = new_email,
    raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', u)
  where id = uid;
end;
$$;

revoke all on function public.rename_username(text) from public;
grant execute on function public.rename_username(text) to authenticated;

create or replace function public.get_avatar_seed()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  seed text;
begin
  if uid is null then
    return null;
  end if;
  select avatar_seed into seed
  from public.usernames
  where user_id = uid
  limit 1;
  return seed;
end;
$$;

revoke all on function public.get_avatar_seed() from public;
grant execute on function public.get_avatar_seed() to authenticated;

create or replace function public.save_avatar_seed(p_seed text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;
  update public.usernames
  set avatar_seed = p_seed
  where user_id = uid;
end;
$$;

revoke all on function public.save_avatar_seed(text) from public;
grant execute on function public.save_avatar_seed(text) to authenticated;

-- ============================================
-- 3. Trigger for auto-creating username on OAuth signup
-- ============================================
create or replace function public.handle_auth_user_username()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  u text;
begin
  u := lower(trim(coalesce(new.raw_user_meta_data->>'username', '')));
  if u = '' or u !~ '^[a-z0-9_-]{3,24}$' then
    return new;
  end if;
  begin
    insert into public.usernames (username, user_id) values (u, new.id);
  exception
    when unique_violation then
      raise exception 'Username already taken' using errcode = '23505';
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_username on auth.users;
create trigger on_auth_user_username
  after insert on auth.users
  for each row execute function public.handle_auth_user_username();

-- ============================================
-- 4. RLS policies (idempotent)
-- ============================================
drop policy if exists "usernames_select_own" on public.usernames;
drop policy if exists "usernames_select_anon" on public.usernames;
drop policy if exists "usernames_select_auth" on public.usernames;
create policy "usernames_select_anon" on public.usernames
  for select to anon
  using (true);
create policy "usernames_select_auth" on public.usernames
  for select to authenticated
  using (true);

-- Allow anon to check availability via the security definer function (no direct table access needed)
grant select on public.usernames to anon;

-- ============================================
-- 5. Data usage snapshot (account menu chips)
-- ============================================
create or replace function public.get_own_data_usage()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_count int := 0;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::int into profile_count
  from public.usernames
  where user_id = uid;

  return jsonb_build_object(
    'templates', profile_count,
    'exercises', 0,
    'schedule', 0,
    'workout_history', 0,
    'tracked_stats', 0,
    'stat_logs', 0,
    'estimated_bytes', greatest(profile_count, 0) * 250,
    'exact', true
  );
end;
$$;

revoke all on function public.get_own_data_usage() from public;
grant execute on function public.get_own_data_usage() to authenticated;

-- ============================================
-- 6. Optional: Basic comment
-- ============================================
comment on table public.usernames is 'Username + password + identicon auth system.';

-- ============================================
-- 7. Essays / Writings (Tractatus blog posts, Substack-like)
-- ============================================

create table if not exists public.essays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  slug text not null,
  title text not null,
  content text not null default '',
  is_public boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint essays_slug_format check (slug ~ '^[a-z0-9-]{1,120}$'),
  constraint essays_unique_slug unique (slug)
);

create index if not exists essays_user_id_idx on public.essays (user_id);
create index if not exists essays_is_public_idx on public.essays (is_public) where is_public = true;

-- Auto updated_at
create or replace function public.set_essays_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists essays_set_updated_at on public.essays;
create trigger essays_set_updated_at
  before update on public.essays
  for each row execute function public.set_essays_updated_at();

alter table public.essays enable row level security;

-- Read: public published essays (anon + auth) or own essays
drop policy if exists "essays_select_public_or_own" on public.essays;
create policy "essays_select_public_or_own" on public.essays
  for select
  to anon, authenticated
  using (is_public = true or user_id = auth.uid());

-- Insert only own
drop policy if exists "essays_insert_own" on public.essays;
create policy "essays_insert_own" on public.essays
  for insert to authenticated
  with check (user_id = auth.uid());

-- Update only own
drop policy if exists "essays_update_own" on public.essays;
create policy "essays_update_own" on public.essays
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Delete only own
drop policy if exists "essays_delete_own" on public.essays;
create policy "essays_delete_own" on public.essays
  for delete to authenticated
  using (user_id = auth.uid());

-- Update data usage to count essays too (for account panel)
create or replace function public.get_own_data_usage()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  profile_count int := 0;
  essay_count int := 0;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select count(*)::int into profile_count
  from public.usernames
  where user_id = uid;

  select count(*)::int into essay_count
  from public.essays
  where user_id = uid;

  return jsonb_build_object(
    'templates', profile_count,
    'exercises', 0,
    'schedule', 0,
    'workout_history', 0,
    'tracked_stats', 0,
    'stat_logs', 0,
    'essays', essay_count,
    'estimated_bytes', (profile_count * 250) + (essay_count * 1800),
    'exact', true
  );
end;
$$;

revoke all on function public.get_own_data_usage() from public;
grant execute on function public.get_own_data_usage() to authenticated;

comment on table public.essays is 'User essays/writings. Private drafts (is_public=false) or published (true). Slug is globally unique for nice URLs.';

-- ============================================
-- 6. Realtime (enable for live feed updates)
-- ============================================
do $$
begin
  alter publication supabase_realtime add table public.essays;
exception when duplicate_object then null;
end;
$$;
do $$
begin
  alter publication supabase_realtime add table public.usernames;
exception when duplicate_object then null;
end;
$$;

