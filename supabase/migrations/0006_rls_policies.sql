-- 0006_rls_policies.sql
-- Row Level Security policies. NOT optional — every table the app touches is
-- access-gated here. The parent magic-URL page uses the service role
-- explicitly (server-side, after token verification) and bypasses RLS.

-- ---------------------------------------------------------------------------
-- Helper: current actor's role from public.users
-- ---------------------------------------------------------------------------
create or replace function public._current_role()
returns public.user_role
language sql stable security definer set search_path = public
as $$
  select role from public.users where id = auth.uid()
$$;

create or replace function public._is_staff()
returns boolean language sql stable as $$
  select public._current_role() in ('driver','aide','table_volunteer','coordinator','admin')
$$;

create or replace function public._is_coordinator()
returns boolean language sql stable as $$
  select public._current_role() in ('coordinator','admin')
$$;

create or replace function public._family_id_for_user(uid uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select g.family_id
  from public.guardians g
  where g.user_id = uid
  limit 1
$$;

create or replace function public._van_assigned_to_user_today(uid uuid)
returns uuid language sql stable security definer set search_path = public
as $$
  select va.van_id
  from public.van_assignments va
  where va.assignment_date = current_date
    and (va.driver_user_id = uid or va.aide_user_id = uid)
  limit 1
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS on every public table
-- ---------------------------------------------------------------------------
alter table public.users                       enable row level security;
alter table public.families                    enable row level security;
alter table public.guardians                   enable row level security;
alter table public.authorized_pickup_persons   enable row level security;
alter table public.students                    enable row level security;
alter table public.consents                    enable row level security;
alter table public.stops                       enable row level security;
alter table public.vans                        enable row level security;
alter table public.routes                      enable row level security;
alter table public.van_assignments             enable row level security;
alter table public.student_day_records         enable row level security;
alter table public.student_day_events          enable row level security;
alter table public.family_access_tokens        enable row level security;
alter table public.van_locations               enable row level security;
alter table public.notifications_sent          enable row level security;
alter table public.incidents                   enable row level security;
alter table public.daily_closeouts             enable row level security;

-- ---------------------------------------------------------------------------
-- users: self + coordinator/admin
-- ---------------------------------------------------------------------------
create policy users_self_select on public.users
  for select using (id = auth.uid() or public._is_coordinator());

create policy users_self_update on public.users
  for update using (id = auth.uid() or public._is_coordinator());

create policy users_coord_insert on public.users
  for insert with check (public._is_coordinator());

-- ---------------------------------------------------------------------------
-- families + guardians + authorized_pickup_persons: own family OR staff
-- ---------------------------------------------------------------------------
create policy families_own_or_staff_select on public.families
  for select using (
    id = public._family_id_for_user(auth.uid())
    or public._is_staff()
  );

create policy families_own_or_coord_update on public.families
  for update using (
    id = public._family_id_for_user(auth.uid())
    or public._is_coordinator()
  );

create policy families_coord_insert on public.families
  for insert with check (public._is_coordinator());

create policy guardians_own_or_staff_select on public.guardians
  for select using (
    family_id = public._family_id_for_user(auth.uid())
    or public._is_staff()
  );
create policy guardians_own_or_coord_write on public.guardians
  for all using (
    family_id = public._family_id_for_user(auth.uid())
    or public._is_coordinator()
  ) with check (
    family_id = public._family_id_for_user(auth.uid())
    or public._is_coordinator()
  );

create policy auth_pickup_own_or_staff_select on public.authorized_pickup_persons
  for select using (
    family_id = public._family_id_for_user(auth.uid())
    or public._is_staff()
  );
create policy auth_pickup_own_or_coord_write on public.authorized_pickup_persons
  for all using (
    family_id = public._family_id_for_user(auth.uid())
    or public._is_coordinator()
  ) with check (
    family_id = public._family_id_for_user(auth.uid())
    or public._is_coordinator()
  );

-- ---------------------------------------------------------------------------
-- students: own family OR any staff (read), coordinator/admin (write)
-- ---------------------------------------------------------------------------
create policy students_own_or_staff_select on public.students
  for select using (
    family_id = public._family_id_for_user(auth.uid())
    or public._is_staff()
  );

create policy students_coord_write on public.students
  for all using (public._is_coordinator())
  with check (public._is_coordinator());

-- ---------------------------------------------------------------------------
-- consents: write-once, own family + coordinator read
-- ---------------------------------------------------------------------------
create policy consents_own_or_coord_select on public.consents
  for select using (
    family_id = public._family_id_for_user(auth.uid())
    or public._is_coordinator()
  );

create policy consents_own_insert on public.consents
  for insert with check (
    family_id = public._family_id_for_user(auth.uid())
    or public._is_coordinator()
  );

-- ---------------------------------------------------------------------------
-- Static-ish reference tables: stops, vans, routes
-- Read by anyone authenticated; write by coordinator/admin only
-- ---------------------------------------------------------------------------
create policy stops_select_all on public.stops
  for select using (auth.uid() is not null);
create policy stops_coord_write on public.stops
  for all using (public._is_coordinator()) with check (public._is_coordinator());

create policy vans_select_all on public.vans
  for select using (auth.uid() is not null);
create policy vans_coord_write on public.vans
  for all using (public._is_coordinator()) with check (public._is_coordinator());

create policy routes_select_all on public.routes
  for select using (auth.uid() is not null);
create policy routes_coord_write on public.routes
  for all using (public._is_coordinator()) with check (public._is_coordinator());

-- ---------------------------------------------------------------------------
-- van_assignments: staff read, coordinator write
-- ---------------------------------------------------------------------------
create policy van_assignments_staff_select on public.van_assignments
  for select using (public._is_staff());
create policy van_assignments_coord_write on public.van_assignments
  for all using (public._is_coordinator()) with check (public._is_coordinator());

-- ---------------------------------------------------------------------------
-- student_day_records: own family read, coordinator write,
-- driver/aide assigned-to-van read for their day, table volunteers read all.
-- ---------------------------------------------------------------------------
create policy sdr_own_or_staff_select on public.student_day_records
  for select using (
    -- own family
    student_id in (
      select id from public.students
      where family_id = public._family_id_for_user(auth.uid())
    )
    -- table_volunteer / coordinator / admin see everyone
    or public._current_role() in ('table_volunteer','coordinator','admin')
    -- driver / aide see students on their assigned van for today
    or (
      public._current_role() in ('driver','aide')
      and event_date = current_date
      and exists (
        select 1
        from public.student_day_status sds
        where sds.student_id = student_day_records.student_id
          and sds.event_date = student_day_records.event_date
          and (
            sds.morning_van_id = public._van_assigned_to_user_today(auth.uid())
            or sds.afternoon_van_id = public._van_assigned_to_user_today(auth.uid())
          )
      )
    )
  );

create policy sdr_coord_write on public.student_day_records
  for all using (public._is_coordinator()) with check (public._is_coordinator());

-- ---------------------------------------------------------------------------
-- student_day_events: client SELECT scoped, NO direct INSERT/UPDATE/DELETE.
-- All writes go through public.record_event() which is SECURITY DEFINER
-- and therefore bypasses RLS for the insert it does internally.
-- ---------------------------------------------------------------------------
create policy events_select_scoped on public.student_day_events
  for select using (
    student_id in (
      select id from public.students
      where family_id = public._family_id_for_user(auth.uid())
    )
    or public._current_role() in ('table_volunteer','coordinator','admin')
    or (
      public._current_role() in ('driver','aide')
      and event_date = current_date
      and van_id = public._van_assigned_to_user_today(auth.uid())
    )
  );

-- Deny direct writes — record_event() is the only writer.
revoke insert, update, delete on public.student_day_events from authenticated;

-- ---------------------------------------------------------------------------
-- family_access_tokens: coordinator only (and the service role; bypasses RLS)
-- ---------------------------------------------------------------------------
create policy fat_coord_select on public.family_access_tokens
  for select using (public._is_coordinator());
create policy fat_coord_write on public.family_access_tokens
  for all using (public._is_coordinator()) with check (public._is_coordinator());

-- ---------------------------------------------------------------------------
-- van_locations: staff read, aide/driver upsert for their own van
-- ---------------------------------------------------------------------------
create policy van_loc_staff_select on public.van_locations
  for select using (public._is_staff());

create policy van_loc_aide_upsert on public.van_locations
  for insert with check (
    van_id = public._van_assigned_to_user_today(auth.uid())
    or public._is_coordinator()
  );

create policy van_loc_aide_update on public.van_locations
  for update using (
    van_id = public._van_assigned_to_user_today(auth.uid())
    or public._is_coordinator()
  );

-- ---------------------------------------------------------------------------
-- notifications_sent: coordinator only (the family-facing view goes through
-- the service role on the parent page anyway).
-- ---------------------------------------------------------------------------
create policy notif_coord_select on public.notifications_sent
  for select using (public._is_coordinator());

-- ---------------------------------------------------------------------------
-- incidents: any staff can write; coordinator can update/delete
-- ---------------------------------------------------------------------------
create policy incidents_staff_select on public.incidents
  for select using (public._is_staff());

create policy incidents_staff_insert on public.incidents
  for insert with check (public._is_staff());

create policy incidents_coord_update on public.incidents
  for update using (public._is_coordinator());

-- ---------------------------------------------------------------------------
-- daily_closeouts: coordinator only
-- ---------------------------------------------------------------------------
create policy closeouts_coord_all on public.daily_closeouts
  for all using (public._is_coordinator()) with check (public._is_coordinator());
