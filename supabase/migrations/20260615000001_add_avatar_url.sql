-- Add avatar_url column for user-uploaded profile pictures
alter table public.usernames add column if not exists avatar_url text;

-- Read own avatar_url
create or replace function public.get_avatar_url()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  url text;
begin
  if uid is null then
    return null;
  end if;
  select avatar_url into url
  from public.usernames
  where user_id = uid
  limit 1;
  return url;
end;
$$;

revoke all on function public.get_avatar_url() from public;
grant execute on function public.get_avatar_url() to authenticated;

-- Write own avatar_url
create or replace function public.save_avatar_url(p_url text)
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
  set avatar_url = p_url
  where user_id = uid;
end;
$$;

revoke all on function public.save_avatar_url(text) from public;
grant execute on function public.save_avatar_url(text) to authenticated;
