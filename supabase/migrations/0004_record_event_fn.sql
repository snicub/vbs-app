-- 0004_record_event_fn.sql
-- The single write entry point for student_day_events.
-- Walks the event log, enforces the state machine, allows overrides
-- only for coordinator/admin + override_reason, dedupes on idempotency_key,
-- serializes per (student, date) with a transaction-scoped advisory lock.

-- ---------------------------------------------------------------------------
-- State derivation: collapse the event log to a single state token.
-- ---------------------------------------------------------------------------
create or replace function public._derive_state(
  p_student_id uuid,
  p_event_date date
) returns text language sql stable as $$
  with last_event as (
    select event_type
    from public.student_day_events
    where student_id = p_student_id
      and event_date = p_event_date
      and superseded_by_event_id is null
      and event_type <> 'override'
    order by occurred_at desc, id desc
    limit 1
  )
  select case
    when (select event_type from last_event) is null then 'not_started'
    when (select event_type from last_event) = 'van_boarded_am' then 'van_boarded_am'
    when (select event_type from last_event) = 'van_offloaded_am' then 'arrived_at_site'
    when (select event_type from last_event) in ('site_checked_in', 'parent_dropoff') then 'site_checked_in'
    when (select event_type from last_event) = 'site_checked_out' then 'site_checked_out'
    when (select event_type from last_event) = 'van_boarded_pm' then 'van_boarded_pm'
    when (select event_type from last_event) in ('van_offloaded_pm', 'parent_pickup') then 'home'
    when (select event_type from last_event) = 'no_show' then 'marked_no_show'
    else 'unknown'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Legality of a (state, event_type) transition.
-- Mirrors src/lib/events/state-machine.ts; the DB is authoritative.
-- ---------------------------------------------------------------------------
create or replace function public._is_legal_transition(
  p_state text,
  p_event_type public.event_type
) returns boolean language sql immutable as $$
  select case p_state
    when 'not_started' then p_event_type in (
      'van_boarded_am', 'parent_dropoff', 'no_show'
    )
    when 'van_boarded_am' then p_event_type in ('van_offloaded_am')
    when 'arrived_at_site' then p_event_type in ('site_checked_in')
    when 'site_checked_in' then p_event_type in ('site_checked_out')
    when 'site_checked_out' then p_event_type in ('van_boarded_pm', 'parent_pickup')
    when 'van_boarded_pm' then p_event_type in ('van_offloaded_pm')
    when 'home' then false                    -- terminal
    when 'marked_no_show' then false          -- terminal except for override
    else false
  end;
$$;

-- ---------------------------------------------------------------------------
-- record_event: the ONLY way events get written.
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
  p_occurred_at timestamptz default null,         -- testing hook; defaults to now()
  p_supersedes_event_id uuid default null         -- for corrections
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

  -- 1. Idempotency check
  select id, student_id, event_date
    into v_existing_id, v_existing_student, v_existing_date
    from public.student_day_events
    where idempotency_key = p_idempotency_key
    limit 1;

  if v_existing_id is not null then
    -- Refuse if same key but different (student, date) — that's a real collision.
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

  -- 2. Serialize per (student, date)
  perform pg_advisory_xact_lock(
    hashtext(p_student_id::text || ':' || p_event_date::text)
  );

  -- 3. Current state from the log
  v_state := public._derive_state(p_student_id, p_event_date);

  -- 4. Legality + override gate
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

  -- 5. Insert the new event
  insert into public.student_day_events (
    student_id, event_date, event_type, van_id, stop_id,
    actor_user_id, actor_role, idempotency_key,
    override_reason, metadata, occurred_at
  ) values (
    p_student_id, p_event_date, p_event_type, p_van_id, p_stop_id,
    p_actor_user_id, p_actor_role, p_idempotency_key,
    p_override_reason, p_metadata, v_occurred_at
  ) returning id into v_event_id;

  -- 6. Optional: mark the predecessor superseded (correction flow)
  if p_supersedes_event_id is not null then
    perform public._mark_superseded(p_supersedes_event_id, v_event_id);
  end if;

  -- 7. Return the new derived state
  return query select
    v_event_id,
    public._derive_state(p_student_id, p_event_date),
    false,
    v_did_override;
end;
$$;

revoke all on function public.record_event(
  uuid, date, public.event_type, uuid, public.user_role, text,
  uuid, uuid, text, jsonb, timestamptz, uuid
) from public;

grant execute on function public.record_event(
  uuid, date, public.event_type, uuid, public.user_role, text,
  uuid, uuid, text, jsonb, timestamptz, uuid
) to authenticated, service_role;
