-- Persists a link to the originally-uploaded plan raster (already sitting
-- in the setout-plan-uploads bucket for AI extraction, previously never
-- referenced again after that) so the main workspace can keep showing it
-- as a reference image behind the traced walls/fittings — useful even
-- where the AI's own tracing is imperfect, since the tradie can always
-- cross-check against the real drawing underneath.

ALTER TABLE public.setout_plans
  ADD COLUMN IF NOT EXISTS background_image_path TEXT,
  ADD COLUMN IF NOT EXISTS background_image_content_type TEXT;
