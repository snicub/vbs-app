-- 0007_realtime.sql
-- Enable realtime on the tables the UI subscribes to.

alter table public.student_day_events  replica identity full;
alter table public.student_day_records replica identity full;
alter table public.van_locations       replica identity full;

-- The `supabase_realtime` publication is created by Supabase on startup.
-- If running outside Supabase locally, create it manually:
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end$$;

alter publication supabase_realtime add table public.student_day_events;
alter publication supabase_realtime add table public.student_day_records;
alter publication supabase_realtime add table public.van_locations;
