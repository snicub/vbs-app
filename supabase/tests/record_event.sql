-- supabase/tests/record_event.sql
-- pgTAP test suite for the record_event function.
-- Run via:  pnpm supabase test db

begin;
select plan(20);

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
insert into auth.users (id, email)
  values
    ('00000000-0000-0000-0000-000000000001', 'parent@example.com'),
    ('00000000-0000-0000-0000-000000000002', 'aide@example.com'),
    ('00000000-0000-0000-0000-000000000003', 'coord@example.com');

insert into public.users (id, full_name, role)
  values
    ('00000000-0000-0000-0000-000000000001', 'Parent A', 'parent'),
    ('00000000-0000-0000-0000-000000000002', 'Aide A',   'aide'),
    ('00000000-0000-0000-0000-000000000003', 'Coord A',  'coordinator');

insert into public.families (id, primary_guardian_name, primary_email, primary_phone)
  values ('10000000-0000-0000-0000-000000000001', 'Parent A', 'parent@example.com', '+15555550101');

insert into public.students (
  id, family_id, legal_first_name, legal_last_name, dob, wristband_code
) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001',
   'Test', 'Kid', '2018-04-01', 'AB23X'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001',
   'Race', 'Kid', '2019-05-02', 'CD34Y');

insert into public.vans (id, name) values
  ('30000000-0000-0000-0000-000000000001', 'Van 1');

-- ---------------------------------------------------------------------------
-- Tests
-- ---------------------------------------------------------------------------

-- (1) Initial state with no events is 'not_started'
select is(
  public._derive_state('20000000-0000-0000-0000-000000000001', current_date),
  'not_started',
  'derive_state with no events returns not_started'
);

-- (2) Aide can record van_boarded_am from not_started
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
  'aide records van_boarded_am from not_started'
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

-- (5) Illegal transition from van_boarded_am to site_checked_in without override
select throws_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'site_checked_in'::public.event_type,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'aide'::public.user_role,
      'test-key-illegal-1'
    )$$,
  'P0001',
  null,
  'aide cannot skip from van_boarded_am to site_checked_in'
);

-- (6) van_offloaded_am is legal next
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

-- (8) Table volunteer / aide can record site_checked_in
select lives_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'site_checked_in'::public.event_type,
      '00000000-0000-0000-0000-000000000003'::uuid,
      'table_volunteer'::public.user_role,
      'test-key-3'
    )$$,
  'site_checked_in legal from arrived_at_site'
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

-- (11) Reject override without reason from non-coordinator
select throws_ok(
  $$select public.record_event(
      '20000000-0000-0000-0000-000000000001'::uuid,
      current_date,
      'site_checked_in'::public.event_type,
      '00000000-0000-0000-0000-000000000002'::uuid,
      'aide'::public.user_role,
      'test-key-illegal-2'
    )$$,
  'P0001',
  null,
  'aide cannot bypass state machine'
);

-- (12) Override with empty reason rejected
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

-- (14) parent_dropoff legal from not_started
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

-- (16) Direct INSERT into student_day_events is blocked for clients (we check
-- via the no-update trigger here; full RLS is exercised in 0006 tests).
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

-- (19) home is terminal (no van_boarded_pm after parent_pickup)
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
    'test-key-pp-2'
  );
end$$;

select is(
  public._derive_state('20000000-0000-0000-0000-000000000002', current_date),
  'home',
  'parent_pickup transitions to home'
);

-- (20) After home, van_boarded_pm without override is rejected
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

select * from finish();
rollback;
