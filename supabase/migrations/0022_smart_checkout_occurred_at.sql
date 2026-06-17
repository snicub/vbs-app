-- 0022_smart_checkout_occurred_at.sql
--
-- Offline support: an afternoon "Dropped off" tapped in a dead zone is queued
-- and replayed minutes later when the van reconnects. Without a client-supplied
-- time, every replayed checkout chain was stamped at SYNC time, not the real
-- drop-off time — skewing the timeline and delaying the is_pm_van_stuck alarm.
--
-- Add an optional p_occurred_at. The chain's events are stamped from it (with
-- the per-event +Nms ordering offset preserved), defaulting to now() for online
-- calls. Everything else is identical to 0021 (deterministic idempotency key +
-- unique-violation no-op, restricted-person block, required pickup name).

create or replace function public.smart_checkout(
  p_student_id uuid,
  p_event_date date,
  p_actor_user_id uuid,
  p_actor_role public.user_role,
  p_pm_path text default null,
  p_pickup_metadata jsonb default '{}'::jsonb,
  p_occurred_at timestamptz default null
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
  v_anchor text;
  v_base timestamptz := coalesce(p_occurred_at, now());
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

  -- Anchor the idempotency keys to the latest event at chain-build time (over
  -- ALL rows incl. superseded/override) so a retry dedupes but a legitimate
  -- re-checkout after an undo (which moves the anchor) records. See 0021.
  select id::text into v_anchor
    from public.student_day_events
    where student_id = p_student_id and event_date = p_event_date
    order by occurred_at desc, id desc
    limit 1;
  v_anchor := coalesce(v_anchor, 'start');

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

    begin
      insert into public.student_day_events (
        student_id, event_date, event_type,
        actor_user_id, actor_role,
        idempotency_key,
        occurred_at,
        metadata
      ) values (
        p_student_id, p_event_date, v_event,
        p_actor_user_id, v_verified_role,
        'smart_checkout:' || p_student_id::text || ':' || p_event_date::text
          || ':' || v_anchor || ':' || v_event::text,
        v_base + (v_count * interval '1 millisecond'),
        v_event_meta
      );
      v_count := v_count + 1;
    exception when unique_violation then
      -- Already recorded by a retried/double-tapped call — idempotent no-op.
      null;
    end;
  end loop;

  return query select
    public._derive_state(p_student_id, p_event_date),
    v_count;
end;
$$;

-- Drop the old 6-arg signature so the name resolves unambiguously to the new one.
drop function if exists public.smart_checkout(uuid, date, uuid, public.user_role, text, jsonb);

revoke all on function public.smart_checkout(
  uuid, date, uuid, public.user_role, text, jsonb, timestamptz
) from public;
grant execute on function public.smart_checkout(
  uuid, date, uuid, public.user_role, text, jsonb, timestamptz
) to authenticated, service_role;

notify pgrst, 'reload schema';
