-- Enable Realtime for tables the public feed depends on.
-- Idempotent: try to add, ignore if already present.
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
