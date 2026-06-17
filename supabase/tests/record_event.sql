-- supabase/tests/record_event.sql
-- pgTAP test suite for record_event / _authorize_event / smart_checkout.
-- Run via:  pnpm supabase:start && pnpm test:db
--
-- UPDATED for the 0017 authorization refactor (and 0019/0021 pickup safety):
-- _authorize_event now runs BEFORE the transition-legality check inside
-- record_event, and a driver/aide is authorized for a van event ONLY when they
-- are assigned to the van the student's stop routes to. The old fixtures had no
-- student_day_records and no van_assignments, so every aide call 42501'd before
-- it could exercise the state machine. The fixtures below give the aide a van
-- assignment and put the students on that van's AM+PM route, so the authz gate
-- passes and the assertions test what they claim to. NOTE: this file is verified
-- only by running it against a local Supabase (Docker); it was last edited
-- without a live run — confirm with `pnpm test:db` before trusting green.

begin;
select plan(23);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
  values
    ('00000000-0000-0000-0000-000000000001', 'parent@example.com'),
    ('00000000-0000-0000-0000-000000000002', 'aide@example.com'),
    ('00000000-0000-0000-0000-000000000003', 'coord@example.com'),
    ('00000000-0000-0000-0000-000000000004', 'volunteer@example.com');

insert into public.users (id, full_name, role)
  values
    ('00000000-0000-0000-0000-000000000001', 'Parent A', 'parent'),
    ('00000000-0000-0000-0000-000000000002', 'Aide A',   'aide'),
    ('00000000-0000-0000-0000-000000000003', 'Coord A',  'coordinator'),
    ('00000000-0000-0000-0000-000000000004', 'Vol A',    'table_volunteer');

insert into public.families (id, primary_guardian_name, primary_email, primary_phone)
  values ('10000000-0000-0000-0000-000000000001', 'Parent A', 'parent@example.com', '+15555550101');

insert into public.students (
  id, family_id, legal_first_name, legal_last_name, dob, wristband_code
) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Test', 'Kid', '2018-04-01', 'AB23X'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Race', 'Kid', '2019-05-02', 'CD34Y'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001',
   'Van', 'Rider', '2017-03-03', 'EF45Z');

insert into public.vans (id, name) values
  ('30000000-0000-0000-0000-000000000001', 'Van 1');

-- One stop, on Van 1's AM and PM routes. Every test student rides Van 1 both
-- legs, so the aide (assigned to Van 1 below) is authorized for their van events
-- and morning_van_id / afternoon_van_id both derive to Van 1.
insert into public.stops (
  id, name, town, color_code, color_name, scheduled_am_time, scheduled_pm_time
) values (
  '40000000-0000-0000-0000-000000000001', 'Test Stop', 'Testville',
  '#3b82f6', 'Blue', '08:00', '16:00'
);

insert into public.routes (van_id, direction, stop_ids) values
  ('30000000-0000-0000-0000-000000000001', 'am',
   array['40000000-0000-0000-0000-000000000001'::uuid]),
  ('30000000-0000-0000-0000-000000000001', 'pm',
   array['40000000-0000-0000-0000-000000000001'::uuid]);

insert into public.van_assignments (assignment_date, van_id, aide_user_id) values (
  current_date, '30000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
);

insert into public.student_day_records (
  student_id, event_date, attending, mode, morning_stop_id, afternoon_stop_id
) values
  ('20000000-0000-0000-0000-000000000001', current_date, true, 'van',
   '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', current_date, true, 'van',
   '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', current_date, true, 'van',
   '40000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------

-- (1) Initial state with no events is 'not_started'
select is(
  public._derive_state('20000000-0000-0000-0000-000000000001', current_date),
  'not_started',
  'derive_state with no events returns not_started'
);

-- (2) Aide ASSIGNED to the van can record van_boarded_am from not_started
select lives_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'van_boarded_am'::public.event_type,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'aide'::public.user_role,
      'test-key-1',
      '30000000-0000-0000-0000-000000000001'::uuid
    )$$,
  'aide assigned to the van records van_boarded_am from not_started'
);

-- (3) State is now 'van_boarded_am'
select is(
  public._derive_state('20000000-0000-0000-0000-000000000001', current_date),
  'van_boarded_am',
  'state advances to van_boarded_am'
);

-- (4) Idempotent retry returns the same event
select is(
  (select (r).was_idempotent from public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'van_boarded_am'::public.event_type,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'aide'::public.user_role,
      'test-key-1'
    ) r),
  true,
  'reusing idempotency_key is a no-op'
);

-- (5) An aide is NOT authorized to record a site event (authz before legality):
--     the gate raises 42501 before the state machine is ever consulted.
select throws_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'site_checked_in'::public.event_type,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'aide'::public.user_role,
      'test-key-illegal-1'
    )$$,
  '42501',
  null,
  'aide is not authorized to record site_checked_in'
);

-- (6) van_offloaded_am is legal next (aide, assigned van)
select lives_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'van_offloaded_am'::public.event_type,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'aide'::public.user_role,
      'test-key-2',
      '30000000-0000-0000-0000-000000000001'::uuid
    )$$,
  'aide records van_offloaded_am'
);

-- (7) State is now arrived_at_site
select is(
  public._derive_state('20000000-0000-0000-0000-000000000001', current_date),
  'arrived_at_site',
  'state advances to arrived_at_site'
);

-- (8) Table volunteer can record site_checked_in
select lives_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'site_checked_in'::public.event_type,
      '00000000-0000-0000-0000-000000000004'::uuid,
      'table_volunteer'::public.user_role,
      'test-key-3'
    )$$,
  'table volunteer records site_checked_in from arrived_at_site'
);

-- (9) Coordinator override with reason allows illegal jump
select lives_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'van_boarded_pm'::public.event_type,
      '00000000-0000-0000-0000-000000000003'::uuid,
      'coordinator'::public.user_role,
      'test-key-override-1',
      null, null,
      'kid had to leave site early via van for emergency'
    )$$,
  'coordinator may skip site_checked_out with override_reason'
);

-- (10) Override flag is recorded
select is(
  (select count(*) from public.student_day_events
    where idempotency_key = 'test-key-override-1' and override_reason is not null)::int,
  1,
  'override_reason persisted'
);

-- (11) An aide still cannot reach a site event even mid-flow — authz, not the
--      state machine, is what stops them (42501).
select throws_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'site_checked_in'::public.event_type,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'aide'::public.user_role,
      'test-key-illegal-2'
    )$$,
  '42501',
  null,
  'aide cannot record a site event regardless of state'
);

-- (12) Coordinator override with empty reason rejected (illegal transition stands)
select throws_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'site_checked_in'::public.event_type,
      '00000000-0000-0000-0000-000000000003'::uuid,
      'coordinator'::public.user_role,
      'test-key-illegal-3',
      null, null,
      '   '
    )$$,
  'P0001',
  null,
  'coordinator override requires non-empty reason'
);

-- (13) Missing idempotency_key is rejected
select throws_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'site_checked_in'::public.event_type,
      '00000000-0000-0000-0000-000000000003'::uuid,
      'coordinator'::public.user_role,
      ''
    )$$,
  'P0001',
  null,
  'empty idempotency_key rejected'
);

-- (14) parent_dropoff legal from not_started (coordinator)
select lives_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000002'::uuid,
      current_date,
      'parent_dropoff'::public.event_type,
      '00000000-0000-0000-0000-000000000003'::uuid,
      'coordinator'::public.user_role,
      'test-key-pd-1'
    )$$,
  'parent_dropoff legal from not_started'
);

-- (15) parent_dropoff yields site_checked_in state
select is(
  public._derive_state('20000000-0000-0000-0000-000000000002', current_date),
  'site_checked_in',
  'parent_dropoff transitions to site_checked_in state'
);

-- (16) Direct UPDATE into student_day_events is blocked (no-update trigger).
select throws_ok(
  $$update public.student_day_events set metadata = '{}'::jsonb
    where idempotency_key = 'test-key-1'$$,
  'P0001',
  null,
  'updates to event log are rejected'
);

-- (17) Same idempotency_key with a different student raises
select throws_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000002'::uuid,
      current_date,
      'parent_dropoff'::public.event_type,
      '00000000-0000-0000-0000-000000000003'::uuid,
      'coordinator'::public.user_role,
      'test-key-1'
    )$$,
  'P0001',
  null,
  'reusing key across students is a hard error'
);

-- (18) Marking a predecessor as superseded works via the helper
do $$
declare
  v_pred uuid;
  v_succ uuid;
begin
  insert into public.student_day_events (
    student_id, event_date, event_type, actor_role, idempotency_key
  ) values (
    '20000000-0000-0000-0000-000000000002', current_date, 'no_show', 'coordinator', 'pred-key-1'
  ) returning id into v_pred;

  insert into public.student_day_events (
    student_id, event_date, event_type, actor_role, idempotency_key, override_reason
  ) values (
    '20000000-0000-0000-0000-000000000002', current_date, 'override', 'coordinator', 'succ-key-1',
    'no_show was wrong; child was present'
  ) returning id into v_succ;

  perform public._mark_superseded(v_pred, v_succ);
end$$;

select is(
  (select count(*) from public.student_day_events
    where idempotency_key = 'pred-key-1' and superseded_by_event_id is not null)::int,
  1,
  '_mark_superseded links predecessor → successor'
);

-- (19) home is terminal (no van_boarded_pm after parent_pickup). The
--      parent_pickup carries a "who picked up" name to satisfy the 0019
--      parent_pickup_has_name CHECK.
do $$
begin
  perform public.record_event(
    '20000000-0000-0000-0000-000000000002'::uuid,
    current_date,
    'site_checked_out'::public.event_type,
    '00000000-0000-0000-0000-000000000003'::uuid,
    'coordinator'::public.user_role,
    'test-key-co-2'
  );
  perform public.record_event(
    '20000000-0000-0000-0000-000000000002'::uuid,
    current_date,
    'parent_pickup'::public.event_type,
    '00000000-0000-0000-0000-000000000003'::uuid,
    'coordinator'::public.user_role,
    'test-key-pp-2',
    null, null, null,
    '{"name": "Parent A"}'::jsonb
  );
end$$;

select is(
  public._derive_state('20000000-0000-0000-0000-000000000002', current_date),
  'home',
  'parent_pickup transitions to home'
);

-- (20) After home, van_boarded_pm is an illegal transition. The aide IS
--      authorized for van_boarded_pm (assigned to the kid's afternoon van), so
--      this proves the STATE MACHINE rejects it (P0001), not authz.
select throws_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000002'::uuid,
      current_date,
      'van_boarded_pm'::public.event_type,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'aide'::public.user_role,
      'test-key-illegal-4'
    )$$,
  'P0001',
  null,
  'home is terminal without override'
);

-- ---------------------------------------------------------------------------
-- (21-22) Regression for 0018: a driver/aide ASSIGNED to a van can complete
-- the PM van check-out chain via smart_checkout. Before 0018 this raised 42501
-- because the whole chain was authorized against 'site_checked_out', which
-- driver/aide may never record — breaking the core van drop-off flow.
-- ---------------------------------------------------------------------------

-- Get the van-rider kid to site_checked_in first (coordinator parent_dropoff).
do $$
begin
  perform public.record_event(
    '20000000-0000-0000-0000-000000000003'::uuid, current_date,
    'parent_dropoff'::public.event_type,
    '00000000-0000-0000-0000-000000000003'::uuid, 'coordinator'::public.user_role,
    'test-key-vanrider-dropoff'
  );
end$$;

-- (21) Aide assigned to the van completes the van PM checkout chain
select lives_ok(
  $$select public.smart_checkout(
      '20000000-0000-0000-0000-000000000003'::uuid,
      current_date,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'aide'::public.user_role,
      'van'
    )$$,
  'aide assigned to the van can smart_checkout a van-mode kid'
);

-- (22) The kid lands home
select is(
  public._derive_state('20000000-0000-0000-0000-000000000003', current_date),
  'home',
  'van-mode kid reaches home after aide check-out'
);

-- ---------------------------------------------------------------------------
-- (23) record_event honors a client-supplied occurred_at. This is the contract
-- the OFFLINE outbox rests on: a queued action replayed at sync time must record
-- when it actually HAPPENED (capture time), not now() — otherwise the AM
-- overdue-van anomalies key off the wrong time. Recorded on a future date so the
-- (student, date) is a clean not_started.
-- ---------------------------------------------------------------------------
do $$
begin
  perform public.record_event(
    '20000000-0000-0000-0000-000000000001'::uuid,
    current_date + 1,
    'parent_dropoff'::public.event_type,
    '00000000-0000-0000-0000-000000000003'::uuid,
    'coordinator'::public.user_role,
    'test-key-occurredat',
    null, null, null, '{}'::jsonb,
    '2026-06-23 08:02:00-05'::timestamptz
  );
end$$;

select is(
  (select occurred_at from public.student_day_events
    where idempotency_key = 'test-key-occurredat'),
  '2026-06-23 08:02:00-05'::timestamptz,
  'record_event stores the client-supplied occurred_at (offline replay records real time)'
);

select * from finish();
rollback;
