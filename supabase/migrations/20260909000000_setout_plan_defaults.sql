-- Job-wide defaults for a setout plan.
--
-- These are seed values only: when a fitting is placed it copies the default
-- it needs into its own specs, so a tradie who changes the job default later
-- never silently moves fittings that are already set out. That's why this is
-- one loose JSONB bag rather than typed columns — the set of things worth
-- defaulting will keep growing (twin downlight spacing today, LED watts per
-- metre and profile with it), and none of it is ever queried on.
--
-- Nothing is needed here for LED strips themselves or the new plate sizes:
-- setout_fittings.type is already TEXT, and specs is already JSONB, so the
-- strip's drawn path, a 4-gang GPO's count and a 6-port data plate all ride
-- in specs with no schema change — the same reason switch gangs live there.

ALTER TABLE public.setout_plans
  ADD COLUMN IF NOT EXISTS plan_defaults JSONB NOT NULL DEFAULT '{}'::jsonb;
