-- 0028_stops_nullable_schedule.sql
--
-- The door-to-door rework dropped forced pickup/drop-off times (and the late
-- alerts that consumed them), so creating a van's pickup-zone stop no longer
-- sets scheduled_am_time / scheduled_pm_time. But those columns were still
-- NOT NULL (from 0002), so provisioning a new van failed with:
--   null value in column "scheduled_am_time" of relation "stops" violates
--   not-null constraint
--
-- Make both nullable. The student_day_status view already guards each late-arrival
-- alarm with `scheduled_*_time is not null`, so a null time simply means "no late
-- alert for this van" — which is the intended behavior now.

alter table public.stops alter column scheduled_am_time drop not null;
alter table public.stops alter column scheduled_pm_time drop not null;

notify pgrst, 'reload schema';
