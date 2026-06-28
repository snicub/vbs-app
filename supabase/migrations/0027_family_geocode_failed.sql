-- 0027_family_geocode_failed.sql
--
-- Records when a family's home address was geocoded but FAILED (the address
-- didn't match any location). Without this, a kid whose address won't geocode
-- looks identical on the Pickup Map to one that simply hasn't been located yet
-- ("tap Locate") — so a bad address can be mistaken for a transient state and
-- the kid silently ends up with no van.
--
--   geocode_failed_at NULL + lat/lng NULL  → not located yet (tap Locate)
--   geocode_failed_at set  + lat/lng NULL  → address didn't match — fix it
--   lat/lng set                            → located (failed flag is cleared)
--
-- Set when a geocode attempt returns no point; cleared on a successful geocode
-- or whenever the coordinator edits the address.

alter table public.families
  add column geocode_failed_at timestamptz;

comment on column public.families.geocode_failed_at is
  'Set when the home address was geocoded but did not match any location; cleared on a successful geocode or an address edit. Distinguishes a bad address from one not yet located.';

notify pgrst, 'reload schema';
