-- 0015_pickup_person_and_capacity.sql
--
-- Three changes to support new safety-critical UX:
--
-- 1. student_day_events.metadata is already jsonb — no schema change needed
--    for recording WHO did parent_pickup. Server actions will write
--    metadata = { authorized_pickup_person_id, name, relationship,
--    is_emergency_contact, was_unlisted } when the table volunteer logs
--    a parent_pickup event. Adding an index so coordinators can query for
--    "who picked up Sally today" without a full scan.
--
-- 2. New smart_checkout signature: accepts an authorized_pickup_person_id
--    UUID (nullable) so the chain's parent_pickup event carries the metadata.
--
-- 3. New `incidents` category constants are app-level conventions; no schema
--    work needed (incidents.category is free-form text).

-- Index for "who picked up student X" queries
CREATE INDEX IF NOT EXISTS student_day_events_pickup_person_idx
  ON public.student_day_events ((metadata->>'authorized_pickup_person_id'))
  WHERE event_type = 'parent_pickup';

-- ---------------------------------------------------------------------------
-- smart_checkout v3: now accepts an optional pickup-person metadata payload
-- that gets stamped onto the parent_pickup event in the chain.
-- ---------------------------------------------------------------------------

-- Drop the old 5-arg signature BEFORE creating the new 6-arg version so
-- PostgREST doesn't get confused by two overloads (PGRST203 would result if
-- the migration partially fails between create + drop).
drop function if exists public.smart_checkout(uuid, date, uuid, public.user_role, text);

create or replace function public.smart_checkout(
  p_student_id uuid,
  p_event_date date,
  p_actor_user_id uuid,
  p_actor_role public.user_role,
  p_pm_path text default null,
  p_pickup_metadata jsonb default '{}'::jsonb
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
  v_event_meta jsonb;
begin
  if v_path not in ('auto', 'parent', 'van') then
    raise exception 'p_pm_path must be auto, parent, or van (got %)', p_pm_path
      using errcode = 'P0001';
  end if;

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
    -- Stamp pickup metadata only on the parent_pickup event; other chained
    -- events get an empty metadata object.
    v_event_meta := case
      when v_event = 'parent_pickup' then coalesce(p_pickup_metadata, '{}'::jsonb)
      else '{}'::jsonb
    end;

    insert into public.student_day_events (
      student_id, event_date, event_type,
      actor_user_id, actor_role,
      idempotency_key,
      occurred_at,
      metadata
    ) values (
      p_student_id, p_event_date, v_event,
      p_actor_user_id, v_verified_role,
      'smart_checkout:' || gen_random_uuid()::text,
      now() + (v_count * interval '1 millisecond'),
      v_event_meta
    );
    v_count := v_count + 1;
  end loop;

  return query select
    public._derive_state(p_student_id, p_event_date),
    v_count;
end;
$$;

revoke all on function public.smart_checkout(
  uuid, date, uuid, public.user_role, text, jsonb
) from public;
grant execute on function public.smart_checkout(
  uuid, date, uuid, public.user_role, text, jsonb
) to authenticated, service_role;

-- Tell PostgREST to reload its schema cache so the new signature is dispatched.
notify pgrst, 'reload schema';
