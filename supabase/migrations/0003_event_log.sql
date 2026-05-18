-- 0003_event_log.sql
-- The append-only event log. NO updates, NO deletes. Corrections are new
-- events whose superseded_by_event_id points at the row being corrected.

create type public.event_type as enum (
  'van_boarded_am',
  'van_offloaded_am',
  'site_checked_in',
  'site_checked_out',
  'van_boarded_pm',
  'van_offloaded_pm',
  'parent_dropoff',
  'parent_pickup',
  'no_show',
  'override'
);

create table public.student_day_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete restrict,
  event_date date not null,
  event_type public.event_type not null,
  van_id uuid references public.vans(id) on delete set null,
  stop_id uuid references public.stops(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_role public.user_role not null,
  occurred_at timestamptz not null default now(),
  idempotency_key text not null,
  override_reason text,
  superseded_by_event_id uuid references public.student_day_events(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create unique index student_day_events_idempotency_uidx
  on public.student_day_events (idempotency_key);

create index student_day_events_student_date_idx
  on public.student_day_events (student_id, event_date, occurred_at desc);

create index student_day_events_date_type_idx
  on public.student_day_events (event_date, event_type);

create index student_day_events_van_date_idx
  on public.student_day_events (van_id, event_date) where van_id is not null;

create index student_day_events_active_idx
  on public.student_day_events (student_id, event_date, occurred_at desc)
  where superseded_by_event_id is null;

-- Hard block on UPDATE/DELETE — the log is append-only.
create or replace function public._reject_event_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'student_day_events is append-only; emit a corrective event instead'
    using errcode = 'P0001';
end;
$$;

create trigger student_day_events_no_update
  before update on public.student_day_events
  for each row execute function public._reject_event_mutation();

create trigger student_day_events_no_delete
  before delete on public.student_day_events
  for each row execute function public._reject_event_mutation();

-- Exception: allow setting superseded_by_event_id ONCE on the predecessor row.
-- We do this via a SECURITY DEFINER helper that bypasses the trigger.
create or replace function public._mark_superseded(
  p_predecessor_id uuid,
  p_successor_id uuid
) returns void language plpgsql security definer as $$
begin
  -- Disable trigger inline for this transaction.
  set local session_replication_role = replica;
  update public.student_day_events
    set superseded_by_event_id = p_successor_id
    where id = p_predecessor_id
      and superseded_by_event_id is null;
  set local session_replication_role = origin;
end;
$$;
revoke all on function public._mark_superseded(uuid, uuid) from public;
