-- 0009_state_machine_v2.sql
-- Simplify the AM flow: site_checked_in is now legal directly from
-- van_boarded_am, so aides no longer have to record a separate
-- van_offloaded_am click. The table volunteer's check-in implicitly covers it.

create or replace function public._is_legal_transition(
  p_state text,
  p_event_type public.event_type
) returns boolean language sql immutable as $$
  select case p_state
    when 'not_started' then p_event_type in (
      'van_boarded_am', 'parent_dropoff', 'no_show'
    )
    -- AM van can transition directly to checked-in (skip the offload click)
    when 'van_boarded_am' then p_event_type in (
      'van_offloaded_am', 'site_checked_in', 'parent_dropoff'
    )
    when 'arrived_at_site' then p_event_type in ('site_checked_in')
    when 'site_checked_in' then p_event_type in ('site_checked_out')
    when 'site_checked_out' then p_event_type in ('van_boarded_pm', 'parent_pickup')
    when 'van_boarded_pm' then p_event_type in ('van_offloaded_pm')
    when 'home' then false
    when 'marked_no_show' then false
    else false
  end;
$$;
