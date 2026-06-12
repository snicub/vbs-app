-- 0016_anomaly_notifications.sql
--
-- Dedup table for anomaly push notifications to the coordinator. We don't
-- want to spam the coordinator's phone with the same "Sally is late AM"
-- text every 5 minutes — once per (student, date, anomaly_kind) is enough.

create table if not exists public.anomaly_notifications (
  student_id uuid not null references public.students(id) on delete cascade,
  event_date date not null,
  anomaly_kind text not null,
  notified_at timestamptz not null default now(),
  notification_id uuid references public.notifications_sent(id) on delete set null,
  primary key (student_id, event_date, anomaly_kind),
  constraint anomaly_notifications_kind_valid check (
    anomaly_kind in ('late_am','boarded_but_not_arrived','in_but_not_out','pm_van_stuck')
  )
);

create index if not exists anomaly_notifications_date_idx
  on public.anomaly_notifications (event_date);

alter table public.anomaly_notifications enable row level security;

drop policy if exists anomaly_notif_coord_select on public.anomaly_notifications;
create policy anomaly_notif_coord_select on public.anomaly_notifications
  for select using (public._is_coordinator());

drop policy if exists anomaly_notif_coord_write on public.anomaly_notifications;
create policy anomaly_notif_coord_write on public.anomaly_notifications
  for all using (public._is_coordinator()) with check (public._is_coordinator());
