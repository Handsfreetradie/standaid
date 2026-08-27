-- Doors/windows cut into a setout plan's walls. Stored as their own JSONB
-- column (parametric against a wall: {wallId, offset, width, kind} — see
-- WallOpening in setoutTypes.ts) rather than a new table, same reasoning as
-- walls/scale_calibration already being plain JSONB on this row: this data
-- only ever needs to be read/written whole, alongside the walls it belongs
-- to, never queried independently.

ALTER TABLE public.setout_plans
  ADD COLUMN IF NOT EXISTS openings JSONB NOT NULL DEFAULT '[]'::jsonb;
