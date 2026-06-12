-- 0012_security_hardening.sql
--
-- Three fixes:
--
-- 1. record_event() and smart_checkout() now verify p_actor_role against
--    the actual role in public.users. Previously a browser-side attacker
--    could call the RPC with p_actor_role='coordinator' to bypass authz.
--
-- 2. is_late_am view filter fixed back to ('van','parent_pickup_only').
--    Migration 0011 incorrectly changed it to ('van','parent_dropoff_only').
--    parent_pickup_only = van AM, parent PM → uses morning van (should flag).
--    parent_dropoff_only = parent AM, van PM → no morning van (should not flag).

-- ---------------------------------------------------------------------------
-- record_event: verify role from DB, never trust the caller
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
  v_verified_role public.user_role;
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
  -- Verify actor role from DB — never trust the caller-supplied value.
  select role into v_verified_role from public.users where id = p_actor_user_id;
  if v_verified_role is null then
    raise exception 'actor_user_id not found in users table'
      using errcode = '42501';
  end if;

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
    p_student_id, p_event_date, p_event_type, p_actor_user_id, v_verified_role
  ) then
    raise exception
      'role % is not authorized to record event % for this student',
      v_verified_role, p_event_type
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

  v_can_override := v_verified_role in ('coordinator', 'admin')
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
    p_actor_user_id, v_verified_role, p_idempotency_key,
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
-- smart_checkout: same role-verification fix
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
  v_verified_role public.user_role;
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

  -- Verify actor role from DB
  select role into v_verified_role from public.users where id = p_actor_user_id;
  if v_verified_role is null then
    raise exception 'actor_user_id not found in users table'
      using errcode = '42501';
  end if;

  if not public._authorize_event(
    p_student_id, p_event_date,
    'site_checked_out'::public.event_type,
    p_actor_user_id, v_verified_role
  ) then
    raise exception
      'role % is not authorized to check out this student',
      v_verified_role
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
    else v_mode in ('van', 'parent_dropoff_only')
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
      idempotency_key,
      occurred_at
    ) values (
      p_student_id, p_event_date, v_event,
      p_actor_user_id, v_verified_role,
      'smart_checkout:' || gen_random_uuid()::text,
      now() + (v_count * interval '1 millisecond')
    );
    v_count := v_count + 1;
  end loop;

  return query select
    public._derive_state(p_student_id, p_event_date),
    v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Fix is_late_am: parent_pickup_only uses the morning van, not parent_dropoff_only
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
     and r.mode in ('van', 'parent_pickup_only')    -- modes that USE the morning van
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
