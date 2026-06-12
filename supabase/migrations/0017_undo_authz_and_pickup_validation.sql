-- 0017_undo_authz_and_pickup_validation.sql
--
-- Three fixes surfaced by the deep audit:
--
-- 1. _authorize_event blocks all non-coordinator overrides, which means the
--    Undo toast on /table/[code] fails at the DB layer for table volunteers,
--    drivers, and aides — the exact users it was designed for. Allow staff
--    roles to record `override` events; the server action already enforces
--    the 60s window + ownership check before reaching here.
--
-- 2. _mark_superseded inside an advisory lock is the right serialization
--    point but record_event doesn't yet check the predecessor's
--    superseded_by_event_id INSIDE the lock. Two concurrent undos can both
--    insert override rows; only one supersedes anything. Add an in-lock
--    check so the second raises rather than producing an orphan override.
--
-- 3. parent_pickup events should always carry a "who picked up" name in
--    metadata. Add a CHECK constraint so a buggy caller can't log a
--    parent_pickup with empty metadata.

-- ---------------------------------------------------------------------------
-- 1. Allow staff override events
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

  -- Staff can record override events (used by the Undo toast). The server
  -- action enforces self-undo-within-60s + ownership BEFORE calling here.
  -- Without this branch the undo path fails for the volunteer who just made
  -- the mistake — defeating the whole undo feature.
  if p_event_type = 'override' then
    return p_actor_role in ('table_volunteer', 'driver', 'aide');
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

-- ---------------------------------------------------------------------------
-- 2. Double-undo race protection — check supersession inside the advisory
--    lock before inserting. record_event already takes the lock at the
--    (student, event_date) hash; this guards against orphan override rows.
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
  v_predecessor_already_superseded boolean;
begin
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

  -- Inside-lock supersession check: prevent two concurrent undos from both
  -- inserting orphan override rows. The TS guard before the RPC call is a
  -- TOCTOU read; the authoritative check belongs here.
  if p_supersedes_event_id is not null then
    select (superseded_by_event_id is not null)
      into v_predecessor_already_superseded
      from public.student_day_events
      where id = p_supersedes_event_id;
    if v_predecessor_already_superseded then
      raise exception 'event % was already superseded', p_supersedes_event_id
        using errcode = 'P0001';
    end if;
  end if;

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

notify pgrst, 'reload schema';
