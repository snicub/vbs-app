-- 0026_student_archive.sql
--
-- Soft archive for students. Replaces the unsafe hard delete (which tried to
-- delete student_day_events — rejected by the append-only trigger — and would
-- have erased custody + consent history).
--
-- An archived student is HIDDEN from every roster and operational screen, but
-- all of their records (events, consents, day-records) are RETAINED, and a
-- coordinator can restore them by clearing archived_at.
--
-- The student_day_status view is the single derived-state read for the app, so
-- excluding archived students here removes them from every screen that drives
-- off the view in one place. The rest of the view body is reproduced VERBATIM
-- from 0023 (a view must be redefined whole); the ONLY change is the inner join
-- to public.students with the `s.archived_at is null` predicate, which makes the
-- view emit no rows for an archived student.

alter table public.students
  add column archived_at timestamptz;

comment on column public.students.archived_at is
  'When set, the student is archived: hidden from rosters/operational screens but all records (events, consents, day-records) are retained. NULL = active.';

create or replace view public.student_day_status as
with active_events as (
  select *
  from public.student_day_events
  where superseded_by_event_id is null
    and event_type <> 'override'
),
last_event as (
  select distinct on (student_id, event_date)
    student_id, event_date,
    id   as last_event_id,
    event_type as last_event_type,
    occurred_at as last_event_at
  from active_events
  order by student_id, event_date, occurred_at desc, id desc
),
aggregates as (
  select
    student_id,
    event_date,
    bool_or(event_type = 'van_boarded_am') as has_van_boarded_am,
    max(occurred_at) filter (where event_type = 'van_boarded_am') as van_boarded_am_at,
    bool_or(event_type in ('site_checked_in', 'parent_dropoff')) as has_checked_in,
    bool_or(event_type = 'site_checked_out') as has_checked_out,
    bool_or(event_type = 'van_boarded_pm') as has_van_boarded_pm,
    max(occurred_at) filter (where event_type = 'van_boarded_pm') as van_boarded_pm_at,
    bool_or(event_type in ('van_offloaded_pm', 'parent_pickup')) as is_home
  from active_events
  group by student_id, event_date
),
am_route as (
  select rt.van_id, unnest(rt.stop_ids) as stop_id
  from public.routes rt
  where rt.direction = 'am'
),
pm_route as (
  select rt.van_id, unnest(rt.stop_ids) as stop_id
  from public.routes rt
  where rt.direction = 'pm'
)
select
  r.id                       as record_id,
  r.student_id,
  r.event_date,
  r.attending,
  r.mode,
  r.morning_stop_id,
  r.afternoon_stop_id,

  coalesce(
    case
      when le.last_event_type is null then 'not_started'
      when le.last_event_type = 'van_boarded_am'    then 'van_boarded_am'
      when le.last_event_type = 'van_offloaded_am'  then 'arrived_at_site'
      when le.last_event_type in ('site_checked_in','parent_dropoff') then 'site_checked_in'
      when le.last_event_type = 'site_checked_out'  then 'site_checked_out'
      when le.last_event_type = 'van_boarded_pm'    then 'van_boarded_pm'
      when le.last_event_type in ('van_offloaded_pm','parent_pickup') then 'home'
      when le.last_event_type = 'no_show'           then 'marked_no_show'
      else 'unknown'
    end,
    'not_started'
  )                          as state,
  le.last_event_id,
  le.last_event_type,
  le.last_event_at,

  am.van_id                  as morning_van_id,
  pm.van_id                  as afternoon_van_id,

  s_am.scheduled_am_time,
  s_pm.scheduled_pm_time,

  coalesce(s_pm.color_code, s_am.color_code) as wristband_color_for_day,
  coalesce(s_pm.color_name, s_am.color_name) as wristband_color_name,

  case
    when r.attending
     and r.event_date = current_date
     and not coalesce(ag.has_van_boarded_am, false)
     and r.mode in ('van', 'parent_pickup_only')    -- modes that USE the morning van
     and s_am.scheduled_am_time is not null
     and now() > ((r.event_date + s_am.scheduled_am_time) at time zone 'America/Chicago')
                   + interval '45 minutes'
    then true else false
  end                        as is_late_am,

  case
    when coalesce(ag.has_van_boarded_am, false)
     and not coalesce(ag.has_checked_in, false)
     and ag.van_boarded_am_at is not null
     and now() > ag.van_boarded_am_at + interval '30 minutes'
    then true else false
  end                        as is_boarded_but_not_arrived,

  case
    when coalesce(ag.has_checked_in, false)
     and not coalesce(ag.has_checked_out, false)
     and s_pm.scheduled_pm_time is not null
     and now() > ((r.event_date + s_pm.scheduled_pm_time) at time zone 'America/Chicago')
                   + interval '30 minutes'
    then true else false
  end                        as is_in_but_not_out,

  case
    when coalesce(ag.has_van_boarded_pm, false)
     and not coalesce(ag.is_home, false)
     and ag.van_boarded_pm_at is not null
     and now() > ag.van_boarded_pm_at + interval '2 hours'
    then true else false
  end                        as is_pm_van_stuck

from public.student_day_records r
join public.students s on s.id = r.student_id and s.archived_at is null
left join last_event le on le.student_id = r.student_id and le.event_date = r.event_date
left join aggregates ag on ag.student_id = r.student_id and ag.event_date = r.event_date
left join am_route am on am.stop_id = r.morning_stop_id
left join pm_route pm on pm.stop_id = r.afternoon_stop_id
left join public.stops s_am on s_am.id = r.morning_stop_id
left join public.stops s_pm on s_pm.id = r.afternoon_stop_id;

notify pgrst, 'reload schema';
