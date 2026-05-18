-- 0002_core_tables.sql
-- Core relational tables (everything except the event log).
-- The append-only event log + record_event() + derived view come in 0003-0005.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.user_role as enum (
  'parent', 'driver', 'aide', 'table_volunteer', 'coordinator', 'admin'
);

create type public.transport_mode as enum (
  'van', 'parent_dropoff_only', 'parent_pickup_only', 'parent_both'
);

create type public.route_direction as enum ('am', 'pm');

create type public.notification_channel as enum ('sms', 'email');
create type public.notification_status as enum (
  'queued', 'sent', 'delivered', 'failed', 'undelivered'
);

create type public.consent_kind as enum (
  'media_release', 'medical', 'transport', 'general_liability', 'photo_release'
);

create type public.incident_severity as enum ('info', 'warning', 'critical');

-- ---------------------------------------------------------------------------
-- public.users — app-level profile + role mirror of auth.users
-- ---------------------------------------------------------------------------
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  phone text,
  email citext,
  role public.user_role not null default 'parent',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index users_role_idx on public.users (role);

-- ---------------------------------------------------------------------------
-- Families and guardians
-- ---------------------------------------------------------------------------
create table public.families (
  id uuid primary key default gen_random_uuid(),
  primary_guardian_name text not null,
  primary_email citext not null,             -- NOT unique: shared emails are real
  primary_phone text not null,
  street_address text,
  city text,
  state text,
  postal_code text,
  lat double precision,
  lng double precision,
  emergency_contact_name text,
  emergency_contact_phone text,
  emergency_contact_relationship text,
  notes text,
  sms_opted_out_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index families_primary_email_idx on public.families (primary_email);
create index families_primary_phone_idx on public.families (primary_phone);

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  full_name text not null,
  email citext,
  phone text,
  relationship text,
  user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index guardians_family_id_idx on public.guardians (family_id);
create index guardians_email_idx on public.guardians (email);
create index guardians_user_id_idx on public.guardians (user_id);

create table public.authorized_pickup_persons (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  full_name text not null,
  phone text,
  relationship text,
  is_restricted boolean not null default false,   -- "do NOT release to"
  notes text,
  created_at timestamptz not null default now()
);
create index authorized_pickup_family_idx on public.authorized_pickup_persons (family_id);

-- ---------------------------------------------------------------------------
-- Students
-- ---------------------------------------------------------------------------
create table public.students (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  legal_first_name text not null,
  legal_last_name text not null,
  preferred_first_name text,
  dob date,
  age_at_registration smallint,
  grade text,
  allergies text,
  medical_notes text,
  photo_path text,                  -- key into the private 'student-photos' bucket
  wristband_code text not null,     -- 5-char, generated in app w/ checksum
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint students_wristband_code_format check (wristband_code ~ '^[A-Z2-9]{5}$'),
  constraint students_dob_xor_age check (
    (dob is not null) or (age_at_registration is not null)
  )
);
create unique index students_wristband_code_uidx on public.students (wristband_code);
create index students_family_id_idx on public.students (family_id);

-- Within a family, no two students can share name+dob, or name+age when dob is missing.
-- Two partial indexes — a single index over (..., dob) would let twins with NULL dobs both insert.
create unique index students_no_dup_by_dob on public.students (
  family_id, lower(legal_first_name), lower(legal_last_name), dob
) where dob is not null;

create unique index students_no_dup_by_age on public.students (
  family_id, lower(legal_first_name), lower(legal_last_name), age_at_registration
) where dob is null;

-- ---------------------------------------------------------------------------
-- Consents (immutable snapshots)
-- ---------------------------------------------------------------------------
create table public.consents (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete restrict,
  kind public.consent_kind not null,
  text_version text not null,         -- e.g. "v1"
  text_hash text not null,            -- sha256 of the canonical text shown
  typed_name text not null,
  ip_address inet,
  user_agent text,
  signed_at timestamptz not null default now()
);
create index consents_family_id_idx on public.consents (family_id);

-- ---------------------------------------------------------------------------
-- Stops, vans, routes, van assignments
-- ---------------------------------------------------------------------------
create table public.stops (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  town text not null,
  street_address text,
  lat double precision,
  lng double precision,
  color_code text not null,           -- e.g. "#ef4444"
  color_name text not null,           -- e.g. "Red"
  scheduled_am_time time not null,
  scheduled_pm_time time not null,
  notes text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table public.vans (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,          -- "Van 1"
  capacity int not null default 14,
  plate text,
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  van_id uuid not null references public.vans(id) on delete cascade,
  direction public.route_direction not null,
  stop_ids uuid[] not null,           -- ordered list
  created_at timestamptz not null default now(),
  unique (van_id, direction)
);
create index routes_van_id_idx on public.routes (van_id);

create table public.van_assignments (
  id uuid primary key default gen_random_uuid(),
  assignment_date date not null,
  van_id uuid not null references public.vans(id) on delete restrict,
  driver_user_id uuid references auth.users(id) on delete set null,
  aide_user_id uuid references auth.users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  unique (assignment_date, van_id)
);
create index van_assignments_date_idx on public.van_assignments (assignment_date);

-- ---------------------------------------------------------------------------
-- Student day records (the plan for each kid on each day)
-- ---------------------------------------------------------------------------
create table public.student_day_records (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  event_date date not null,
  attending boolean not null default true,
  mode public.transport_mode not null,
  morning_stop_id uuid references public.stops(id) on delete set null,
  afternoon_stop_id uuid references public.stops(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, event_date)
);
create index student_day_records_date_idx on public.student_day_records (event_date);

-- ---------------------------------------------------------------------------
-- Family access tokens (for the parent magic-URL status page)
-- ---------------------------------------------------------------------------
create table public.family_access_tokens (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references public.families(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index family_access_tokens_token_uidx on public.family_access_tokens (token);
create index family_access_tokens_family_idx on public.family_access_tokens (family_id);

-- ---------------------------------------------------------------------------
-- Van locations (one row per van, upserted on each report)
-- ---------------------------------------------------------------------------
create table public.van_locations (
  van_id uuid primary key references public.vans(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  accuracy_m double precision,
  heading_deg double precision,
  speed_mps double precision,
  reported_at timestamptz not null default now(),
  reported_by_user_id uuid references auth.users(id) on delete set null
);

-- ---------------------------------------------------------------------------
-- Notifications log
-- ---------------------------------------------------------------------------
create table public.notifications_sent (
  id uuid primary key default gen_random_uuid(),
  family_id uuid references public.families(id) on delete set null,
  channel public.notification_channel not null,
  template_key text not null,
  recipient text not null,            -- phone or email
  subject text,
  body text not null,
  provider_id text,
  status public.notification_status not null default 'queued',
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_sent_family_idx on public.notifications_sent (family_id);
create index notifications_sent_template_idx on public.notifications_sent (template_key);

-- ---------------------------------------------------------------------------
-- Incidents (free-form safety incident log)
-- ---------------------------------------------------------------------------
create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  reported_by_user_id uuid references auth.users(id) on delete set null,
  severity public.incident_severity not null default 'info',
  category text not null,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  student_id uuid references public.students(id) on delete set null,
  van_id uuid references public.vans(id) on delete set null,
  resolved_at timestamptz,
  resolved_by_user_id uuid references auth.users(id) on delete set null
);
create index incidents_occurred_at_idx on public.incidents (occurred_at desc);

-- ---------------------------------------------------------------------------
-- Daily closeouts
-- ---------------------------------------------------------------------------
create table public.daily_closeouts (
  event_date date primary key,
  closed_at timestamptz not null default now(),
  closed_by_user_id uuid references auth.users(id) on delete set null,
  notes text,
  pending_anomalies jsonb not null default '[]'::jsonb
);

-- ---------------------------------------------------------------------------
-- Touch updated_at trigger (used by a few tables above)
-- ---------------------------------------------------------------------------
create or replace function public._touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger users_touch_updated_at
  before update on public.users
  for each row execute function public._touch_updated_at();

create trigger families_touch_updated_at
  before update on public.families
  for each row execute function public._touch_updated_at();

create trigger students_touch_updated_at
  before update on public.students
  for each row execute function public._touch_updated_at();

create trigger student_day_records_touch_updated_at
  before update on public.student_day_records
  for each row execute function public._touch_updated_at();
