-- 0019_pickup_safety.sql
--
-- Two pickup-safety gaps surfaced by the production-readiness audit:
--
-- 1. The "who picked up" record was never enforced. 0017's header promised a
--    CHECK constraint forcing parent_pickup events to carry a pickup name, but
--    the constraint was never created — so a child could be released with no
--    record of who took them. Added below (NOT VALID so it only governs new
--    rows; the append-only log's legacy rows are left untouched). Coordinator
--    OVERRIDE pickups are exempt: they carry an override_reason that documents
--    the release instead.
--
-- 2. "Do not release to" (authorized_pickup_persons.is_restricted) was a UI
--    banner with zero server-side teeth. smart_checkout now refuses to release
--    a child to a restricted person — matched by id OR by name, so a free-form
--    typed name can't bypass it — and requires a non-empty pickup name. This is
--    the DB backstop for the same check in the smartCheckOut server action
--    (covers direct RPC calls).

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
  v_auth_event public.event_type;
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

  -- Authorize the chain by its kind (only when there's actually a chain to
  -- record). A van-PM chain is gated on van_offloaded_pm (assigned-van check);
  -- a parent chain is gated on parent_pickup (table/coordinator only).
  if array_length(v_chain, 1) is not null then
    v_auth_event := case when v_uses_van_pm
                         then 'van_offloaded_pm'::public.event_type
                         else 'parent_pickup'::public.event_type
                    end;
    if not public._authorize_event(
      p_student_id, p_event_date, v_auth_event, p_actor_user_id, v_verified_role
    ) then
      raise exception
        'role % is not authorized to check out this student',
        v_verified_role
        using errcode = '42501';
    end if;
  end if;

  foreach v_event in array v_chain loop
    -- Pickup safety: a parent_pickup must record WHO took the child, and must
    -- never be to a person marked "do not release to" (matched by id or name).
    if v_event = 'parent_pickup' then
      if coalesce(btrim(p_pickup_metadata->>'name'), '') = '' then
        raise exception 'parent_pickup requires a pickup person name'
          using errcode = 'P0001';
      end if;
      if exists (
        select 1
        from public.authorized_pickup_persons ap
        join public.students st on st.id = p_student_id
        where ap.family_id = st.family_id
          and ap.is_restricted
          and (
            ap.id = nullif(p_pickup_metadata->>'authorized_pickup_person_id', '')::uuid
            or lower(btrim(ap.full_name)) = lower(btrim(p_pickup_metadata->>'name'))
          )
      ) then
        raise exception 'pickup person is marked do-not-release'
          using errcode = '42501';
      end if;
    end if;

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

-- A released child must have a recorded pickup person. Exempt coordinator
-- overrides (they carry an override_reason). NOT VALID: enforce on new inserts
-- only, never retroactively reject existing append-only rows.
alter table public.student_day_events
  drop constraint if exists parent_pickup_has_name;
alter table public.student_day_events
  add constraint parent_pickup_has_name
  check (
    event_type <> 'parent_pickup'
    or override_reason is not null
    or (metadata ? 'name' and btrim(coalesce(metadata->>'name', '')) <> '')
  ) not valid;

notify pgrst, 'reload schema';
