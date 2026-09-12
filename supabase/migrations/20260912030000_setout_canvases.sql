-- Multi-story plans / extra canvases inside a job. Today one setout_plans
-- row (a job) has exactly one drawing surface — walls/openings/scale/
-- background image all live flat on that one row. This adds
-- setout_canvases: one row per floor/area within a job, so a two-storey
-- house can have a Ground Floor and First Floor canvas, or a job can add an
-- unrelated extra canvas (e.g. Outdoor Lighting) that isn't on the house
-- plan at all. setout_plans keeps only job-wide fields going forward (name,
-- job_reference, plan_defaults) — its old geometry columns are left in
-- place, unused, rather than dropped in this pass (see the note at the end).
--
-- setout_fittings and setout_photo_points gain a canvas_id column, kept
-- alongside their existing plan_id (unchanged) — so a fitting/photo point
-- says both "which job" and "which floor/area". setout_circuits and
-- setout_voice_notes are untouched: they stay plan_id-scoped only, shared
-- across every canvas in the job (one switchboard, one Max Demand total,
-- one materials list covering the whole job).

-- 1. New table.
CREATE TABLE public.setout_canvases (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES public.setout_plans(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL DEFAULT 'Ground Floor',
  sort_order INTEGER NOT NULL DEFAULT 0,
  source_type TEXT NOT NULL CHECK (source_type IN ('import', 'draw')),
  scale_calibration JSONB,
  walls JSONB NOT NULL DEFAULT '[]'::jsonb,
  openings JSONB NOT NULL DEFAULT '[]'::jsonb,
  wall_thickness JSONB NOT NULL DEFAULT '{"exterior": 0.03, "interior": 0.015}'::jsonb,
  layer_visibility JSONB NOT NULL DEFAULT '{}'::jsonb,
  background_image_path TEXT,
  background_image_content_type TEXT,
  source_file_path TEXT,
  source_file_content_type TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_setout_canvases_plan ON public.setout_canvases (plan_id);

ALTER TABLE public.setout_canvases ENABLE ROW LEVEL SECURITY;

-- Same plan->child ownership join-hop pattern used by every other setout_*
-- child table (setout_circuits, setout_fittings, setout_photo_points).
CREATE POLICY "Users can view own setout canvases" ON public.setout_canvases FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert own setout canvases" ON public.setout_canvases FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can update own setout canvases" ON public.setout_canvases FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can delete own setout canvases" ON public.setout_canvases FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);

CREATE TRIGGER update_setout_canvases_updated_at BEFORE UPDATE ON public.setout_canvases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2. Backfill: one "Ground Floor" canvas per existing plan, carrying over
-- every field that used to live on the plan row.
INSERT INTO public.setout_canvases
  (plan_id, name, sort_order, source_type, scale_calibration, walls, openings,
   wall_thickness, layer_visibility, background_image_path, background_image_content_type,
   source_file_path, source_file_content_type, created_at, updated_at)
SELECT
  id, 'Ground Floor', 0, source_type, scale_calibration, walls, openings,
  COALESCE(wall_thickness, '{"exterior": 0.03, "interior": 0.015}'::jsonb),
  COALESCE(layer_visibility, '{}'::jsonb),
  background_image_path, background_image_content_type,
  source_file_path, source_file_content_type, created_at, updated_at
FROM public.setout_plans;

-- 3. New canvas_id columns, nullable at first so the backfill below can run
-- against tables that may already hold rows.
ALTER TABLE public.setout_fittings ADD COLUMN canvas_id UUID REFERENCES public.setout_canvases(id) ON DELETE CASCADE;
ALTER TABLE public.setout_photo_points ADD COLUMN canvas_id UUID REFERENCES public.setout_canvases(id) ON DELETE CASCADE;

-- 4. Point every existing fitting/photo point at its plan's new (and, at
-- this point, only) canvas.
UPDATE public.setout_fittings f
  SET canvas_id = c.id
  FROM public.setout_canvases c
  WHERE c.plan_id = f.plan_id AND f.canvas_id IS NULL;

UPDATE public.setout_photo_points p
  SET canvas_id = c.id
  FROM public.setout_canvases c
  WHERE c.plan_id = p.plan_id AND p.canvas_id IS NULL;

-- 5. Now that every row has one, require it going forward.
ALTER TABLE public.setout_fittings ALTER COLUMN canvas_id SET NOT NULL;
ALTER TABLE public.setout_photo_points ALTER COLUMN canvas_id SET NOT NULL;

CREATE INDEX idx_setout_fittings_canvas ON public.setout_fittings (canvas_id);
CREATE INDEX idx_setout_photo_points_canvas ON public.setout_photo_points (canvas_id);

-- Deliberately NOT done here: dropping setout_plans.walls / .openings /
-- .wall_thickness / .scale_calibration / .background_image_path /
-- .background_image_content_type / .source_file_path /
-- .source_file_content_type. They're now unused (superseded by the columns
-- of the same name on setout_canvases) but left in place as a safe first
-- step on live data — a cleanup migration to drop them can follow once this
-- has been used in production for a while.
