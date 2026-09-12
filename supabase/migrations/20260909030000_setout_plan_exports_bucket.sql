-- Public storage for the exported marked-up plan PDF, so the QR code
-- printed on the switchboard legend can open it without the scanner needing
-- to be logged in — same public-read pattern as standard-figures
-- (20260508000001), scoped to a per-user upload folder. One file per plan,
-- named by the plan's own (already-unguessable) UUID, overwritten on every
-- export so the QR link never changes.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'setout-plan-exports',
  'setout-plan-exports',
  true,
  20971520, -- 20MB
  ARRAY['application/pdf']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "setout_plan_exports_public_read" ON storage.objects FOR SELECT
  USING (bucket_id = 'setout-plan-exports');
CREATE POLICY "setout_plan_exports_owner_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'setout-plan-exports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "setout_plan_exports_owner_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'setout-plan-exports' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "setout_plan_exports_owner_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'setout-plan-exports' AND auth.uid()::text = (storage.foldername(name))[1]);
