-- 0018_smart_checkout_authz_fix.sql
--
-- CRITICAL fix surfaced by the full-repo audit.
--
-- smart_checkout authorized the ENTIRE check-out chain against a single
-- hard-coded event type, 'site_checked_out' (0015 lines 70-79). But
-- _authorize_event (0017) only lets a driver/aide record the four van events
-- — never site_checked_out. So when a driver/aide tapped "Dropped off (check
-- out)" on the van manifest, smart_checkout raised 42501 every time, even from
-- van_boarded_pm where the only remaining step (van_offloaded_pm) is one they
-- ARE allowed to record. Net effect: the core PM van drop-off flow — the
-- driver marking each kid home at their stop — was completely broken for the
-- exact roles meant to use it. Only coordinators/admins could complete it.
--
-- Fix: authorize the chain by its KIND once we know it, not against a fixed
-- event. The manifest's "Dropped off" collapses the whole PM journey to home
-- in one tap, and for a van-PM kid the driver IS the person taking the child
-- from the site onto the van — so a van-PM chain is gated on van_offloaded_pm
-- (which _authorize_event already restricts to the kid's assigned afternoon
-- van), and a parent-pickup chain is gated on parent_pickup (which correctly
-- keeps drivers/aides out of parent pickups; only table_volunteer/coordinator/
-- admin qualify). Coordinators/admins still pass unconditionally.
--
-- The authorization decision moves AFTER state/mode/path derivation (inside
-- the advisory lock), which is strictly safer than the previous pre-lock gate.
-- Signature is unchanged.

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

notify pgrst, 'reload schema';
