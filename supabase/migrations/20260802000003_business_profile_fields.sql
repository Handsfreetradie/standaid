-- Business branding for Site Audit PDF reports: a logo + licence number set
-- once on the profile, plus sign-off fields on the audit itself. Sign-off
-- fields are a snapshot taken at the moment of signing (not read live from
-- the profile), so a later profile edit never rewrites the record of what a
-- past report said.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS business_name TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS licence_number TEXT;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS logo_storage_path TEXT;

ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS signed_off_by TEXT;
ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS signed_off_licence TEXT;
ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS signed_off_at TIMESTAMPTZ;

-- ── Private storage bucket for business logos ──────────────────────────────
-- Same per-user-folder RLS pattern as audit-photos (20260706000000).
INSERT INTO storage.buckets (id, name, public)
VALUES ('business-logos', 'business-logos', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "business_logos_storage_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'business-logos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "business_logos_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'business-logos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "business_logos_storage_update" ON storage.objects FOR UPDATE
  USING (bucket_id = 'business-logos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "business_logos_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'business-logos' AND auth.uid()::text = (storage.foldername(name))[1]);
