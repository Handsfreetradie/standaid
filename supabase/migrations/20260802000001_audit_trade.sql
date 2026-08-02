-- Site Audit was hardcoded to electrical content (photo tags, AI prompt).
-- Adds a trade per audit so the UI and the analyze-audit-photo function can
-- tailor tags/prompt/retrieval to the user's actual trade. Nullable — older
-- audits fall back to generic wording in the edge function.
ALTER TABLE public.audits ADD COLUMN IF NOT EXISTS trade TEXT;
