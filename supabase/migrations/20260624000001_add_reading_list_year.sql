-- Add first_publish_year to reading_list so year is available immediately
alter table public.reading_list
  add column if not exists first_publish_year integer;

comment on column public.reading_list.first_publish_year is 'From OpenLibrary search API, used for display in book overlay';
