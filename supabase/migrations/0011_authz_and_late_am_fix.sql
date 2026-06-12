-- 0011_authz_and_late_am_fix.sql
--
-- Two safety fixes:
--
-- 1. Per-student authorization on record_event() and smart_checkout().
--    Previously both functions were SECURITY DEFINER and trusted any
--    signed-in caller with any student_id + event_type. That meant a
--    signed-in parent could mutate any kid by guessing UUIDs, and a
--    table volunteer could submit van_boarded_pm / no_show despite the
--    role spec. _authorize_event() centralizes the role×event×student
--    matrix; both entry points call it before doing anything.
--
-- 2. is_late_am view filter used mode in ('van','parent_pickup_only')
--    where it should be ('van','parent_dropoff_only'). The "van or
--    parent-dropoff (van home)" pair is the set of modes that USE the
--    morning van; parent_pickup_only has the van bring the kid home but
--    NO morning van. The mirror in smart_checkout (line 47) already
--    used the correct pair for PM-van.

-- ---------------------------------------------------------------------------
-- _authorize_event: returns true iff actor may record this event for this kid
-- ---------------------------------------------------------------------------
create or replace function public._authorize_event(
  p_student_id uuid,
  p_event_date date,
  p_event_type public.event_type,
  p_actor_user_id uuid,
  p_actor_role public.user_role
) returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_morning_van uuid;
  v_afternoon_van uuid;
  v_assigned_van uuid;
begin
  if p_actor_role in ('admin', 'coordinator') then
    return true;
  end if;

  if p_actor_role = 'parent' then
    return false;
  end if;

  if p_actor_role = 'table_volunteer' then
    return p_event_type in (
      'parent_dropoff',
      'site_checked_in',
      'site_checked_out',
      'parent_pickup',
      'no_show'
    );
  end if;

  if p_actor_role in ('driver', 'aide') then
    if p_event_type not in (
      'van_boarded_am', 'van_offloaded_am',
      'van_boarded_pm', 'van_offloaded_pm'
    ) then
      return false;
    end if;
    v_assigned_van := public._van_assigned_to_user_today(p_actor_user_id);
    if v_assigned_van is null then
      return false;
    end if;
    select morning_van_id, afternoon_van_id
      into v_morning_van, v_afternoon_van
      from public.student_day_status
      where student_id = p_student_id
        and event_date = p_event_date;
    if p_event_type in ('van_boarded_am', 'van_offloaded_am') then
      return v_morning_van = v_assigned_van;
    else
      return v_afternoon_van = v_assigned_van;
    end if;
  end if;

  return false;
end;
$$;

revoke all on function public._authorize_event(
  uuid, date, public.event_type, uuid, public.user_role
) from public;
grant execute on function public._authorize_event(
  uuid, date, public.event_type, uuid, public.user_role
) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- record_event: now authorizes before doing anything else.
-- ---------------------------------------------------------------------------
create or replace function public.record_event(
  p_student_id uuid,
  p_event_date date,
  p_event_type public.event_type,
  p_actor_user_id uuid,
  p_actor_role public.user_role,
  p_idempotency_key text,
  p_van_id uuid default null,
  p_stop_id uuid default null,
  p_override_reason text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null,
  p_supersedes_event_id uuid default null
) returns table (
  event_id uuid,
  derived_state text,
  was_idempotent boolean,
  was_override boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing_id uuid;
  v_existing_student uuid;
  v_existing_date date;
  v_state text;
  v_event_id uuid;
  v_is_legal boolean;
  v_can_override boolean;
  v_did_override boolean := false;
  v_occurred_at timestamptz := coalesce(p_occurred_at, now());
begin
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    raise exception 'idempotency_key is required' using errcode = 'P0001';
  end if;

  select id, student_id, event_date
    into v_existing_id, v_existing_student, v_existing_date
    from public.student_day_events
    where idempotency_key = p_idempotency_key
    limit 1;

  if v_existing_id is not null then
    if v_existing_student <> p_student_id or v_existing_date <> p_event_date then
      raise exception 'idempotency_key % already used for a different student/date',
        p_idempotency_key using errcode = 'P0001';
    end if;
    return query select
      v_existing_id,
      public._derive_state(p_student_id, p_event_date),
      true,
      false;
    return;
  end if;

  if not public._authorize_event(
    p_student_id, p_event_date, p_event_type, p_actor_user_id, p_actor_role
  ) then
    raise exception
      'role % is not authorized to record event % for this student',
      p_actor_role, p_event_type
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_student_id::text || ':' || p_event_date::text)
  );

  v_state := public._derive_state(p_student_id, p_event_date);

  if p_event_type = 'override' then
    v_is_legal := true;
    v_did_override := true;
  else
    v_is_legal := public._is_legal_transition(v_state, p_event_type);
  end if;

  v_can_override := p_actor_role in ('coordinator', 'admin')
                    and p_override_reason is not null
                    and length(trim(p_override_reason)) > 0;

  if not v_is_legal then
    if v_can_override then
      v_did_override := true;
    else
      raise exception
        'illegal transition: event % from state % (override_reason required for coordinator/admin)',
        p_event_type, v_state
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.student_day_events (
    student_id, event_date, event_type, van_id, stop_id,
    actor_user_id, actor_role, idempotency_key,
    override_reason, metadata, occurred_at
  ) values (
    p_student_id, p_event_date, p_event_type, p_van_id, p_stop_id,
    p_actor_user_id, p_actor_role, p_idempotency_key,
    p_override_reason, p_metadata, v_occurred_at
  ) returning id into v_event_id;

  if p_supersedes_event_id is not null then
    perform public._mark_superseded(p_supersedes_event_id, v_event_id);
  end if;

  return query select
    v_event_id,
    public._derive_state(p_student_id, p_event_date),
    false,
    v_did_override;
end;
$$;

-- ---------------------------------------------------------------------------
-- smart_checkout: authorizes on site_checked_out (chain head); chained
-- van_boarded_pm / van_offloaded_pm / parent_pickup events ride on that
-- since the volunteer at the table initiates the entire chain.
--
-- p_pm_path lets the caller force the PM half of the chain instead of
-- inferring from the kid's transport mode:
--   'auto'   (or null) — pick from mode (the default; matches old behavior)
--   'parent' — chain ends with parent_pickup (parent is here picking up now)
--   'van'    — chain ends with van_boarded_pm + van_offloaded_pm
-- This is what supports "parent showed up early to grab a van-mode kid" —
-- the volunteer doesn't need a coordinator override anymore.
-- ---------------------------------------------------------------------------
create or replace function public.smart_checkout(
  p_student_id uuid,
  p_event_date date,
  p_actor_user_id uuid,
  p_actor_role public.user_role,
  p_pm_path text default null
) returns table (
  final_state text,
  events_recorded int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_mode public.transport_mode;
  v_uses_van_pm boolean;
  v_chain public.event_type[];
  v_event public.event_type;
  v_count int := 0;
  v_path text := coalesce(nullif(p_pm_path, ''), 'auto');
begin
  if v_path not in ('auto', 'parent', 'van') then
    raise exception 'p_pm_path must be auto, parent, or van (got %)', p_pm_path
      using errcode = 'P0001';
  end if;

  if not public._authorize_event(
    p_student_id, p_event_date,
    'site_checked_out'::public.event_type,
    p_actor_user_id, p_actor_role
  ) then
    raise exception
      'role % is not authorized to check out this student',
      p_actor_role
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_student_id::text || ':' || p_event_date::text)
  );

  v_state := public._derive_state(p_student_id, p_event_date);

  select mode into v_mode
    from public.student_day_records
    where student_id = p_student_id and event_date = p_event_date;
  if v_mode is null then
    raise exception 'No day record for student/date' using errcode = 'P0001';
  end if;

  v_uses_van_pm := case v_path
    when 'parent' then false
    when 'van'    then true
    else v_mode in ('van', 'parent_dropoff_only')   -- auto
  end;

  if v_state = 'site_checked_in' then
    v_chain := array['site_checked_out'::public.event_type] ||
               (case when v_uses_van_pm
                     then array['van_boarded_pm'::public.event_type,
                                'van_offloaded_pm'::public.event_type]
                     else array['parent_pickup'::public.event_type]
                end);
  elsif v_state = 'site_checked_out' then
    v_chain := case when v_uses_van_pm
                    then array['van_boarded_pm'::public.event_type,
                               'van_offloaded_pm'::public.event_type]
                    else array['parent_pickup'::public.event_type]
                end;
  elsif v_state = 'van_boarded_pm' then
    -- van path already started; finishing it regardless of p_pm_path
    v_chain := array['van_offloaded_pm'::public.event_type];
  elsif v_state in ('home', 'marked_no_show') then
    v_chain := array[]::public.event_type[];
  else
    raise exception 'Cannot check out from state %', v_state using errcode = 'P0001';
  end if;

  foreach v_event in array v_chain loop
    insert into public.student_day_events (
      student_id, event_date, event_type,
      actor_user_id, actor_role,
      idempotency_key
    ) values (
      p_student_id, p_event_date, v_event,
      p_actor_user_id, p_actor_role,
      'smart_checkout:' || gen_random_uuid()::text
    );
    v_count := v_count + 1;
  end loop;

  return query select
    public._derive_state(p_student_id, p_event_date),
    v_count;
end;
$$;

-- Drop the old 4-arg signature; the 5-arg version with p_pm_path replaces it.
drop function if exists public.smart_checkout(uuid, date, uuid, public.user_role);

revoke all on function public.smart_checkout(uuid, date, uuid, public.user_role, text)
  from public;
grant execute on function public.smart_checkout(uuid, date, uuid, public.user_role, text)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Fix is_late_am mode filter.
-- ---------------------------------------------------------------------------
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
     and r.mode in ('van', 'parent_dropoff_only')      -- modes that USE morning van
     and s_am.scheduled_am_time is not null
     and now() > ((r.event_date + s_am.scheduled_am_time) at time zone current_setting('TIMEZONE'))
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
     and now() > ((r.event_date + s_pm.scheduled_pm_time) at time zone current_setting('TIMEZONE'))
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
left join last_event le on le.student_id = r.student_id and le.event_date = r.event_date
left join aggregates ag on ag.student_id = r.student_id and ag.event_date = r.event_date
left join am_route am on am.stop_id = r.morning_stop_id
left join pm_route pm on pm.stop_id = r.afternoon_stop_id
left join public.stops s_am on s_am.id = r.morning_stop_id
left join public.stops s_pm on s_pm.id = r.afternoon_stop_id;
