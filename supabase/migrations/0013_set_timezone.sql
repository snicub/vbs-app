-- 0013_set_timezone.sql
--
-- Set the database timezone to US Central (South Dakota) so that
-- current_date, now(), and current_setting('TIMEZONE') all produce
-- the church's local time. Without this, the anomaly flags in
-- student_day_status fire 5 hours early (CDT = UTC-5) and RLS
-- policies using current_date flip to the next day at 7 PM CDT.
--
-- VBS is in late June (CDT = UTC-5).

ALTER DATABASE postgres SET timezone = 'America/Chicago';
