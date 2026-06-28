-- Allow everyone (anon + authenticated) to read all reading logs
-- so the public feed in DiaryPanel shows reviews from all users.
alter table reading_logs enable row level security;

drop policy if exists "reading_logs_select_all" on public.reading_logs;
create policy "reading_logs_select_all" on public.reading_logs
  for select
  to anon, authenticated
  using (true);

-- Users can insert their own logs
drop policy if exists "reading_logs_insert_own" on public.reading_logs;
create policy "reading_logs_insert_own" on public.reading_logs
  for insert to authenticated
  with check (user_id = auth.uid());

-- Users can update their own logs
drop policy if exists "reading_logs_update_own" on public.reading_logs;
create policy "reading_logs_update_own" on public.reading_logs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Users can delete their own logs
drop policy if exists "reading_logs_delete_own" on public.reading_logs;
create policy "reading_logs_delete_own" on public.reading_logs
  for delete to authenticated
  using (user_id = auth.uid());
