-- Close an unrestricted INSERT policy on the standard-figures bucket.
--
-- 20260607000002_fix_standard_figures_bucket.sql added:
--
--   CREATE POLICY "Service role can insert standard figures"
--     ON storage.objects FOR INSERT
--     WITH CHECK (bucket_id = 'standard-figures');
--
-- with the stated intent of documenting that edge functions write here. But it
-- names no role and constrains no path, and storage policies are OR'd — so it
-- granted INSERT on ANY path in that bucket to `anon` and `authenticated`
-- alike, i.e. to anyone holding the (public by design) anon key. They could
-- write objects into another user's folder, e.g. <victim-uuid>/<std>/x.png.
--
-- The policy bought nothing: service role bypasses RLS entirely, so dropping
-- it does not affect any edge function. Legitimate client-side writes remain
-- covered by the folder-scoped "Users can upload their own standard images"
-- policy from 20260508000001.

DROP POLICY IF EXISTS "Service role can insert standard figures" ON storage.objects;
