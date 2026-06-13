alter table public.essays
  drop column if exists author_username,
  drop column if exists author_avatar_seed;
