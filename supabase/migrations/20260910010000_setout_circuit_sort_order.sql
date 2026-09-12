-- Lets a tradie arrange circuits into the order they actually want printed
-- on the switchboard legend (matching the physical pole layout on the
-- board), instead of always listing them in creation order.

ALTER TABLE public.setout_circuits ADD COLUMN IF NOT EXISTS sort_order INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows so they keep their current (creation-order) display
-- instead of all collapsing to 0 and re-sorting unpredictably the moment
-- this ships.
WITH ranked AS (
  SELECT id, row_number() OVER (PARTITION BY plan_id ORDER BY created_at ASC) - 1 AS rn
  FROM public.setout_circuits
)
UPDATE public.setout_circuits sc
SET sort_order = ranked.rn
FROM ranked
WHERE sc.id = ranked.id;
