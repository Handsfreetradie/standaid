-- Raise the standards PDF upload cap from the project-wide default (50MB) to
-- 70MB by setting an explicit per-bucket limit, so it no longer depends on
-- the Supabase dashboard's global storage setting.
UPDATE storage.buckets
SET file_size_limit = 73400320 -- 70MB
WHERE id = 'standards';
