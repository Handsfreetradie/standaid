-- Lets a circuit carry a type (solar, and future types like EV charging)
-- plus type-specific fields, without a wide sparse table for every future
-- circuit type — same JSONB-bucket pattern already used for
-- setout_fittings.specs. No CHECK constraint, matching every other
-- type/category column in this schema (setout_fittings.type/category) —
-- gated by the TypeScript-level union client-side instead.

ALTER TABLE public.setout_circuits ADD COLUMN IF NOT EXISTS circuit_type TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE public.setout_circuits ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '{}'::jsonb;
