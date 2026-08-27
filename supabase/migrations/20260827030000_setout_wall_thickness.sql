-- Wall line thickness for the plan view/export — separate values for
-- exterior vs interior walls, since those are typically very different in
-- real life (e.g. 230mm brick veneer external vs 90mm stud internal) and a
-- fixed cosmetic line width doesn't read as an actual building. See
-- WallThickness in setoutTypes.ts.
ALTER TABLE public.setout_plans
  ADD COLUMN IF NOT EXISTS wall_thickness JSONB NOT NULL DEFAULT '{"exterior": 0.23, "interior": 0.11}'::jsonb;
