-- Migration 045: Job photos and customer signature storage
--
-- Adds job_photos table for multi-photo capture and a signature URL column on jobs.
-- Photos and signatures are stored in Supabase Storage bucket 'job-media'.
--
-- SETUP REQUIRED: Create the storage bucket in the Supabase Dashboard:
--   Storage → New Bucket → Name: "job-media" → Private (not public)
--   Then set this RLS policy on the bucket objects so techs can upload their own jobs' media:
--
--   CREATE POLICY "tenant_job_media" ON storage.objects
--     FOR ALL USING (
--       bucket_id = 'job-media'
--       AND (storage.foldername(name))[1] IN (
--         SELECT id::TEXT FROM tenants
--         WHERE id = get_my_tenant_id()
--       )
--     );

ALTER TABLE jobs
  ADD COLUMN IF NOT EXISTS customer_signature_url TEXT,
  ADD COLUMN IF NOT EXISTS customer_signed_at TIMESTAMPTZ;

COMMENT ON COLUMN jobs.customer_signature_url IS
  'Storage path to customer signature PNG captured on job completion.';

CREATE TABLE IF NOT EXISTS job_photos (
  id         UUID        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id  UUID        NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  job_id     UUID        NOT NULL REFERENCES jobs(id)    ON DELETE CASCADE,
  storage_path TEXT      NOT NULL,  -- Supabase Storage path within job-media bucket
  public_url TEXT,                  -- pre-signed or public URL (set after upload)
  caption    TEXT,
  taken_by   UUID        REFERENCES users(id),
  taken_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE job_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation" ON job_photos
  FOR ALL USING (tenant_id = get_my_tenant_id());

CREATE INDEX idx_job_photos_job_id ON job_photos (job_id);
CREATE INDEX idx_job_photos_tenant ON job_photos (tenant_id, taken_at DESC);
