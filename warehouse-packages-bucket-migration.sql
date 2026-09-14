-- Warehouse "packages" storage bucket
-- ===================================
-- Fixes "Bucket not found" when a warehouse account takes/uploads a photo of
-- the packed products. Packed photos are uploaded to the public `packages`
-- bucket under a `packing/<invoice>/` prefix
-- (app/api/warehouse/queue/[id]/photo/route.ts).
--
-- Run this in the Supabase SQL editor. Idempotent — safe to run more than once.

-- Create the public `packages` bucket (or make it public if it already exists).
insert into storage.buckets (id, name, public)
values ('packages', 'packages', true)
on conflict (id) do update set public = true;

-- Uploads and deletes go through the service-role key, which bypasses RLS, so
-- no write policy is required. A public bucket already serves its objects via
-- public URLs, but we add an explicit public-read policy to make the intent
-- clear and resilient. Wrapped so the migration still succeeds on projects
-- where the SQL role can't own policies on storage.objects (the public bucket
-- flag alone is enough for reads there).
do $$
begin
  drop policy if exists "Public read packages" on storage.objects;
  create policy "Public read packages" on storage.objects
    for select
    to public
    using (bucket_id = 'packages');
exception
  when insufficient_privilege then
    raise notice 'Skipped storage.objects policy (insufficient privilege); the public bucket flag already allows public reads.';
end $$;

-- Verify (optional): should return one row with public = true.
-- select id, name, public from storage.buckets where id = 'packages';
