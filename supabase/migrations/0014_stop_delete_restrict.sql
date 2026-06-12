-- 0014_stop_delete_restrict.sql
-- Tighten FK constraints on student_day_records so that deleting a stop is
-- rejected instead of silently NULLing stop assignments.
--
-- ON DELETE SET NULL is dangerous here: a deleted stop would quietly break
-- van-ID derivation, wristband-color derivation, and all four anomaly flags
-- for every kid assigned to that stop — with no visible error.
--
-- ON DELETE RESTRICT makes the accidental delete impossible; a coordinator
-- must reassign all affected students before a stop can be removed.

ALTER TABLE public.student_day_records
  DROP CONSTRAINT IF EXISTS student_day_records_morning_stop_id_fkey,
  ADD CONSTRAINT student_day_records_morning_stop_id_fkey
    FOREIGN KEY (morning_stop_id) REFERENCES public.stops(id) ON DELETE RESTRICT;

ALTER TABLE public.student_day_records
  DROP CONSTRAINT IF EXISTS student_day_records_afternoon_stop_id_fkey,
  ADD CONSTRAINT student_day_records_afternoon_stop_id_fkey
    FOREIGN KEY (afternoon_stop_id) REFERENCES public.stops(id) ON DELETE RESTRICT;
