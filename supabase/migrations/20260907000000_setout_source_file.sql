-- Keep the file the tradie actually uploaded, not just the picture we made
-- from it.
--
-- Until now only the rendered PNG was stored, and the original PDF was thrown
-- away after import. That PNG is a dead end: a PDF carries the real line
-- geometry — exact coordinates and stroke widths — and once it has been
-- flattened to pixels the only way back is to estimate it, which tops out
-- around 3mm because one pixel of the working image is tens of millimetres of
-- building. Keeping the source means the workspace can snap fittings to the
-- true face of a wall, and re-render the plan sharply at any zoom, instead of
-- magnifying a fixed bitmap.
--
-- Nullable: plans imported before this, and plans imported from a photo rather
-- than a PDF, have no vector source and fall back to the pixel path.

ALTER TABLE public.setout_plans
  ADD COLUMN IF NOT EXISTS source_file_path TEXT,
  ADD COLUMN IF NOT EXISTS source_file_content_type TEXT;

COMMENT ON COLUMN public.setout_plans.source_file_path IS
  'Storage path of the originally uploaded plan file (PDF or image) in the setout-plan-uploads bucket. Null for plans imported before this column existed.';
