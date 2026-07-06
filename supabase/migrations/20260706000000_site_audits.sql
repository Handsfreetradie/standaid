-- Site Audit feature (Pro): a tradie walks a job, photographs each item, and
-- the AI assesses each photo against their uploaded standards and asks for the
-- measurements it can't see. All data is private to the owning user.

CREATE TABLE IF NOT EXISTS public.audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  site_address TEXT,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | complete
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.audit_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  label TEXT,                              -- e.g. Switchboard / RCD / Wet area
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | analyzing | done | failed
  what_i_see TEXT,
  assessments JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{point, verdict, clause}]
  needs_to_know JSONB NOT NULL DEFAULT '[]'::jsonb, -- ["distance from sink?", ...]
  severity TEXT,                           -- compliant | concern | non_compliant | cant_tell
  user_notes TEXT,                         -- answers to the AI's questions (Q&A loop)
  citations JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audits_user ON public.audits (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_photos_audit ON public.audit_photos (audit_id, created_at);

ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_photos ENABLE ROW LEVEL SECURITY;

-- Audits — full CRUD on your own rows
CREATE POLICY "audits_select_own" ON public.audits FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "audits_insert_own" ON public.audits FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "audits_update_own" ON public.audits FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "audits_delete_own" ON public.audits FOR DELETE USING (auth.uid() = user_id);

-- Audit photos — user manages their own rows; the edge function (service role)
-- writes the analysis fields and bypasses RLS.
CREATE POLICY "audit_photos_select_own" ON public.audit_photos FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "audit_photos_insert_own" ON public.audit_photos FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "audit_photos_update_own" ON public.audit_photos FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "audit_photos_delete_own" ON public.audit_photos FOR DELETE USING (auth.uid() = user_id);

-- ── Private storage bucket for audit photos ────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('audit-photos', 'audit-photos', false)
ON CONFLICT (id) DO NOTHING;

-- Each user can only touch objects under their own {user_id}/ prefix.
CREATE POLICY "audit_photos_storage_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'audit-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "audit_photos_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'audit-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "audit_photos_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'audit-photos' AND auth.uid()::text = (storage.foldername(name))[1]);
