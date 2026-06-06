-- Make the standard-figures storage bucket private.
-- The bucket was created public in 20260508000001_standard_figures_tables.sql
-- so that chat responses could reference images directly. Now we scope access
-- to authenticated users only, serving images via signed URLs or the API.

-- Switch bucket to private
UPDATE storage.buckets
SET public = false
WHERE id = 'standard-figures';

-- Remove the blanket public-read policy added in the original migration
DROP POLICY IF EXISTS "Public read for standard images" ON storage.objects;

-- Authenticated users can read figures stored under their own user-id folder
-- (path structure: standard-figures/<user_id>/...)
CREATE POLICY "Users can read own standard figures"
  ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'standard-figures'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

-- Edge functions (service role) need to write figures during PDF extraction.
-- Service role bypasses RLS, but an explicit policy keeps the intent clear.
CREATE POLICY "Service role can insert standard figures"
  ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'standard-figures');
