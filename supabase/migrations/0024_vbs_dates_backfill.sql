-- Backfill per-day plan rows for the corrected VBS dates (June 30 – July 2, 2026).
--
-- Earlier registrations created day-records for the old placeholder week
-- (June 22–26). Without rows for the real dates, check-in would show
-- "No schedule for this child" for every already-registered kid on the actual
-- event days. For each student that already has at least one day-record, create
-- a row for each real VBS date carrying that student's existing transport mode
-- (stops left null — the coordinator assigns vans from addresses). New
-- registrations already use the corrected dates from src/lib/registration/dates.ts.
--
-- Idempotent: the unique (student_id, event_date) constraint + ON CONFLICT means
-- re-running inserts nothing new. The old June 22–26 rows are left untouched
-- (harmless; the app only operates on the current VBS window).

insert into public.student_day_records (student_id, event_date, attending, mode)
select existing.student_id, d.event_date, true, existing.mode
from (
  select distinct on (student_id) student_id, mode
  from public.student_day_records
  order by student_id, event_date
) as existing
cross join (values
  ('2026-06-30'::date),
  ('2026-07-01'::date),
  ('2026-07-02'::date)
) as d(event_date)
on conflict (student_id, event_date) do nothing;
