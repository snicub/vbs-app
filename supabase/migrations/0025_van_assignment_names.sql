-- Typed-in driver/aide names for the no-login kiosk event.
--
-- Volunteers don't have app accounts at this one-time event, so the coordinator
-- types the driver's and aide's names rather than picking from a (always-empty)
-- account dropdown. The existing driver_user_id/aide_user_id FK columns are kept
-- intact for historical rows and possible future per-driver login scoping.

alter table public.van_assignments
  add column driver_name text,
  add column aide_name text;

comment on column public.van_assignments.driver_name is
  'Typed-in driver name for the no-login event (volunteers have no accounts). driver_user_id stays for historical rows / future login scoping.';
comment on column public.van_assignments.aide_name is
  'Typed-in aide name for the no-login event (volunteers have no accounts). aide_user_id stays for historical rows / future login scoping.';
