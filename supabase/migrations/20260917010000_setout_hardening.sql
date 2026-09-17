-- Setout hardening pass — closes gaps found in an audit of the Rough-In
-- Setout module ahead of wider rollout:
--
-- 1. The add-on entitlement (has_setout_addon + trade_type) was only ever
--    checked client-side (SetoutRoute) and in extract-setout-plan — a user
--    could INSERT into setout_plans directly via the client Supabase key
--    and use the module without paying for it. RLS is the only place this
--    can actually be enforced.
-- 2. Rough-In Setout is being opened up to HVAC as well as electrical —
--    every trade_type check across the module needs both.
-- 3. setout_plans gains export_token, the unguessable value the exported
--    plan PDF is now named after in the setout-plan-exports bucket
--    (${user.id}/${export_token}.pdf), instead of the plan's own id.
-- 4. Two of the four Setout storage buckets were never given a size/type
--    cap (unlike setout-voice-notes and setout-plan-exports).
-- 5. setout_fittings/setout_load_items/setout_photo_points let canvas_id /
--    circuit_id be set to *any* UUID on INSERT/UPDATE, including one that
--    belongs to a different plan (even a different user's plan) — RLS only
--    ever checked plan_id ownership, never that the referenced canvas/
--    circuit actually belongs to that same plan.

-- pgcrypto for gen_random_bytes() below — gen_random_uuid() elsewhere in
-- this schema is Postgres-native (13+), but gen_random_bytes() is pgcrypto.
-- Supabase projects have this installed by default; IF NOT EXISTS makes
-- this a no-op there.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Server-side entitlement gate on setout_plans INSERT ─────────────────
--
-- Reusable, SECURITY DEFINER so it can read public.profiles regardless of
-- the profiles RLS policies in force — it only ever evaluates the caller's
-- own row (auth.uid()), so unlike check_and_record_ai_usage/match_chunks
-- (20260706000001_lock_tier_and_rpc_grants.sql) it takes no target-user
-- parameter and can't be used to probe anyone else's entitlement. Safe to
-- leave executable by authenticated (the default grant).
CREATE OR REPLACE FUNCTION public.has_setout_access()
RETURNS BOOLEAN
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.user_id = auth.uid()
      AND p.has_setout_addon = true
      AND (p.trade_type ILIKE '%electrical%' OR p.trade_type ILIKE '%hvac%')
  );
$$;

DROP POLICY IF EXISTS "Users can insert own setout plans" ON public.setout_plans;
CREATE POLICY "Users can insert own setout plans" ON public.setout_plans FOR INSERT WITH CHECK (
  auth.uid() = user_id AND public.has_setout_access()
);

-- SELECT/UPDATE/DELETE stay owner-only (unchanged) — a plan already created
-- while the add-on was active must stay readable/editable if the
-- subscription later lapses, same as every other add-on in this app.

-- ── 2. Export token ──────────────────────────────────────────────────────
-- The client will store export PDFs at ${user.id}/${export_token}.pdf in
-- setout-plan-exports instead of ${user.id}/${plan.id}.pdf — the plan id is
-- already exposed to the owner throughout the app UI/URLs, so naming the
-- public export file after it would make every past export guessable by
-- anyone who ever saw a plan id. export_token is a random value never shown
-- anywhere else. DEFAULT backfills existing rows automatically.
ALTER TABLE public.setout_plans
  ADD COLUMN IF NOT EXISTS export_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex');

COMMENT ON COLUMN public.setout_plans.export_token IS
  'Random value the exported plan PDF is named after in setout-plan-exports (${user.id}/${export_token}.pdf), so the public export URL does not leak the plan id.';

-- ── 3. Child-table integrity — canvas_id / circuit_id must belong to the
--    same plan as the row being written, not just be *a* valid id ─────────

-- setout_fittings: canvas_id (setout_canvases) and circuit_id (setout_circuits)
DROP POLICY IF EXISTS "Users can insert own setout fittings" ON public.setout_fittings;
CREATE POLICY "Users can insert own setout fittings" ON public.setout_fittings FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
  AND (canvas_id IS NULL OR EXISTS (
    SELECT 1 FROM public.setout_canvases c WHERE c.id = canvas_id AND c.plan_id = setout_fittings.plan_id
  ))
  AND (circuit_id IS NULL OR EXISTS (
    SELECT 1 FROM public.setout_circuits sc WHERE sc.id = circuit_id AND sc.plan_id = setout_fittings.plan_id
  ))
);

DROP POLICY IF EXISTS "Users can update own setout fittings" ON public.setout_fittings;
CREATE POLICY "Users can update own setout fittings" ON public.setout_fittings FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
  AND (canvas_id IS NULL OR EXISTS (
    SELECT 1 FROM public.setout_canvases c WHERE c.id = canvas_id AND c.plan_id = setout_fittings.plan_id
  ))
  AND (circuit_id IS NULL OR EXISTS (
    SELECT 1 FROM public.setout_circuits sc WHERE sc.id = circuit_id AND sc.plan_id = setout_fittings.plan_id
  ))
);

-- setout_photo_points: canvas_id (setout_canvases) only — no circuit_id column
DROP POLICY IF EXISTS "Users can insert own setout photo points" ON public.setout_photo_points;
CREATE POLICY "Users can insert own setout photo points" ON public.setout_photo_points FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
  AND (canvas_id IS NULL OR EXISTS (
    SELECT 1 FROM public.setout_canvases c WHERE c.id = canvas_id AND c.plan_id = setout_photo_points.plan_id
  ))
);

DROP POLICY IF EXISTS "Users can update own setout photo points" ON public.setout_photo_points;
CREATE POLICY "Users can update own setout photo points" ON public.setout_photo_points FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
  AND (canvas_id IS NULL OR EXISTS (
    SELECT 1 FROM public.setout_canvases c WHERE c.id = canvas_id AND c.plan_id = setout_photo_points.plan_id
  ))
);

-- setout_load_items: circuit_id (setout_circuits) only — no canvas_id column
DROP POLICY IF EXISTS "Users can insert own setout load items" ON public.setout_load_items;
CREATE POLICY "Users can insert own setout load items" ON public.setout_load_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
  AND (circuit_id IS NULL OR EXISTS (
    SELECT 1 FROM public.setout_circuits sc WHERE sc.id = circuit_id AND sc.plan_id = setout_load_items.plan_id
  ))
);

DROP POLICY IF EXISTS "Users can update own setout load items" ON public.setout_load_items;
CREATE POLICY "Users can update own setout load items" ON public.setout_load_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
) WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
  AND (circuit_id IS NULL OR EXISTS (
    SELECT 1 FROM public.setout_circuits sc WHERE sc.id = circuit_id AND sc.plan_id = setout_load_items.plan_id
  ))
);

-- ── 4. Storage bucket size/type caps ────────────────────────────────────
-- setout-plan-uploads and setout-photo-points were created without limits
-- (20260827000000/20260831000000) — setout-voice-notes and
-- setout-plan-exports already have them. Allowlists cover every
-- contentType/accept the client actually uses (CalibrationImportFlow.tsx's
-- file input takes application/pdf,image/* and uploads the original
-- file's own type; SetoutPlan.tsx's photo-point capture always re-encodes
-- to image/jpeg via compressImageToBlob — png/webp kept as headroom for
-- direct uploads without breaking anything already working).
UPDATE storage.buckets
SET file_size_limit = 26214400, -- 25MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
WHERE id = 'setout-plan-uploads';

UPDATE storage.buckets
SET file_size_limit = 15728640, -- 15MB
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
WHERE id = 'setout-photo-points';

-- ── 5. Storage DELETE policies ──────────────────────────────────────────
-- Audited: every setout bucket (setout-plan-uploads, setout-photo-points,
-- setout-voice-notes, setout-plan-exports) already has an owner-folder-scoped
-- DELETE policy from its creation migration. Nothing to add here.
