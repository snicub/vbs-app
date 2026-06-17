-- 0021_smart_checkout_idempotent.sql
--
-- smart_checkout minted a fresh random idempotency_key per event
-- (`'smart_checkout:' || gen_random_uuid()`), so the unique index could never
-- catch a retried release. The per-(student,date) advisory lock + state
-- re-derivation already prevent a duplicate chain under the deployed READ
-- COMMITTED isolation (a second tap re-derives to a terminal state and records
-- nothing) — but that safety rested on an invisible isolation-level assumption,
-- and the random key meant a duplicate `parent_pickup` (two pickup-person
-- records, possibly different names) could never be rejected by the index if
-- that assumption ever broke. On the van screen — the retry-prone surface — that
-- is the dangerous case.
--
-- Fix: make the key deterministic so an identical re-submission collides on the
-- unique index and becomes a clean no-op (caught below), turning idempotency
-- into an explicit DB guarantee instead of an emergent one. The key is anchored
-- to the latest event at chain-build time, so a *legitimate* re-checkout after a
-- coordinator override — which appends new events, moving the anchor — gets
-- fresh keys and still records. Only an identical retry against the same event
-- history dedupes.
--
-- Reproduces 0019 verbatim except: the new v_anchor capture, the deterministic
-- key, and the unique_violation guard around the insert. All pickup-safety
-- checks (restricted-person block, required pickup name) are unchanged.

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
  v_anchor text;
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

  -- Anchor the idempotency keys to the latest event at chain-build time, over
  -- ALL rows (including superseded + override). A retried/double-tapped checkout
  -- sees the same anchor and collides on the unique index (no duplicate chain).
  -- An Undo records an `override` row that supersedes the prior checkout step;
  -- because that override IS the new latest row, the anchor moves, so a
  -- legitimate re-checkout after the undo computes a fresh key and records.
  -- (Filtering out superseded/override rows here would collapse the anchor back
  -- to the pre-checkout event and silently dedupe the redo — the kid would stay
  -- stuck mid-chain. So this query is deliberately unfiltered.)
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
        now() + (v_count * interval '1 millisecond'),
        v_event_meta
      );
      v_count := v_count + 1;
    exception when unique_violation then
      -- This exact step was already recorded by a retried/double-tapped call.
      -- Idempotent no-op: the derived state already reflects it.
      null;
    end;
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

notify pgrst, 'reload schema';
