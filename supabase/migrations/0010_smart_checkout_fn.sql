-- 0010_smart_checkout_fn.sql
-- Atomic "check out" — chains the events to land a kid in `home` state in
-- a single transaction with one advisory lock. Replaces the JS-level chain
-- in src/server-actions/check-out.ts which executed each event as its own
-- transaction (recoverable on partial failure, but left ambiguous state
-- visible to coordinators during the gap).

create or replace function public.smart_checkout(
  p_student_id uuid,
  p_event_date date,
  p_actor_user_id uuid,
  p_actor_role public.user_role
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
begin
  -- Single advisory lock for the entire chain. Concurrent attempts at the
  -- same (student, date) serialize; once we hold the lock, no other
  -- record_event call on this kid+date can interleave.
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

  -- van or parent_dropoff_only ride the van home in PM; parent_pickup_only
  -- and parent_both go via parent_pickup.
  v_uses_van_pm := v_mode in ('van', 'parent_dropoff_only');

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

revoke all on function public.smart_checkout(uuid, date, uuid, public.user_role) from public;
grant execute on function public.smart_checkout(uuid, date, uuid, public.user_role)
  to authenticated, service_role;
