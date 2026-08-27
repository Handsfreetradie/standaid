-- Private storage bucket for source files (PDF/photo rasters) uploaded to
-- the AI plan-import flow. Only the derived wall geometry/fittings are kept
-- long-term on setout_plans/setout_fittings; this bucket exists so the
-- extract-setout-plan edge function has something to download and analyse —
-- same private, owner-scoped-folder pattern as audit-photos
-- (20260706000000_site_audits.sql).

INSERT INTO storage.buckets (id, name, public)
VALUES ('setout-plan-uploads', 'setout-plan-uploads', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "setout_plan_uploads_storage_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'setout-plan-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "setout_plan_uploads_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'setout-plan-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "setout_plan_uploads_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'setout-plan-uploads' AND auth.uid()::text = (storage.foldername(name))[1]);
