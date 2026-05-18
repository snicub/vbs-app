-- 0008_storage_buckets.sql
-- Two private storage buckets. Access only via short-lived signed URLs
-- generated server-side by code that has already verified the requester.

insert into storage.buckets (id, name, public)
  values
    ('student-photos', 'student-photos', false),
    ('wristbands',     'wristbands',     false)
  on conflict (id) do nothing;

-- Object-level policies: only the service role writes; clients read via signed URL.
create policy "student-photos: service role full access"
  on storage.objects for all
  using (bucket_id = 'student-photos' and auth.role() = 'service_role')
  with check (bucket_id = 'student-photos' and auth.role() = 'service_role');

create policy "student-photos: coordinator full access"
  on storage.objects for all
  using (bucket_id = 'student-photos' and public._is_coordinator())
  with check (bucket_id = 'student-photos' and public._is_coordinator());

create policy "wristbands: service role full access"
  on storage.objects for all
  using (bucket_id = 'wristbands' and auth.role() = 'service_role')
  with check (bucket_id = 'wristbands' and auth.role() = 'service_role');

create policy "wristbands: coordinator full access"
  on storage.objects for all
  using (bucket_id = 'wristbands' and public._is_coordinator())
  with check (bucket_id = 'wristbands' and public._is_coordinator());
