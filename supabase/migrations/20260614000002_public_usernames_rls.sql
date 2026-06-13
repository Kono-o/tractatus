-- Allow anon (unauthenticated users) and authenticated users
-- to read all usernames from the usernames table.
-- Required for the public feed to display author names.
drop policy if exists "usernames_select_own" on public.usernames;
drop policy if exists "usernames_select_anon" on public.usernames;
drop policy if exists "usernames_select_auth" on public.usernames;

create policy "usernames_select_anon" on public.usernames
  for select to anon
  using (true);

create policy "usernames_select_auth" on public.usernames
  for select to authenticated
  using (true);
