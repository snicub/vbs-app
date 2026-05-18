-- 0001_extensions.sql
-- Postgres extensions used across the app.

create extension if not exists "pgcrypto";   -- gen_random_uuid, digest
create extension if not exists "citext";     -- case-insensitive email
create extension if not exists "pg_trgm";    -- fuzzy name search
