-- ─────────────────────────────────────────────────────────────────────────
-- StandAid Feedback & Query Log Schema
-- ─────────────────────────────────────────────────────────────────────────
--
-- Purpose: Capture every query and its user feedback so we can:
--   1. Review bad responses weekly
--   2. Build a training dataset for future fine-tuning
--   3. Track accuracy trends over time
--
-- Run this in Supabase SQL Editor, or save as a migration file:
--   supabase/migrations/YYYYMMDDHHMMSS_add_feedback_and_query_log.sql
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- Table 1: query_log
-- Records every query the AI handled. Referenced by query_feedback.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- What was asked
  query_text TEXT NOT NULL,
  trade TEXT, -- 'electrical' | 'plumbing' | 'mechanical' | 'structural' | 'building' | 'general'
  standard_id UUID, -- optional reference to standards table if you have one

  -- What was returned
  response_text TEXT,

  -- Retrieval metadata — which chunks were used
  retrieved_chunk_ids UUID[],
  retrieved_chunk_count INTEGER,

  -- Validation metadata from validation-v2
  confidence_score NUMERIC(3,2),
  validation_issues JSONB, -- array of { type, severity, detail }
  needs_review BOOLEAN DEFAULT FALSE,

  -- Model info
  model_used TEXT DEFAULT 'gpt-4o-mini',

  -- Timing
  created_at TIMESTAMPTZ DEFAULT NOW(),
  response_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_query_log_user_id ON public.query_log(user_id);
CREATE INDEX IF NOT EXISTS idx_query_log_created_at ON public.query_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_log_needs_review ON public.query_log(needs_review) WHERE needs_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_query_log_trade ON public.query_log(trade);

-- ─────────────────────────────────────────────────────────────────────────
-- Table 2: query_feedback
-- User's rating of a response. One query can have multiple feedback rows
-- if you later add "thumbs up" + "send detailed feedback" flows.
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.query_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID NOT NULL REFERENCES public.query_log(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  -- The core rating
  rating TEXT NOT NULL CHECK (rating IN ('helpful', 'wrong', 'unclear')),

  -- Optional detail from the user
  user_comment TEXT,

  -- Review workflow state
  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,

  -- Future: mark as training data
  approved_for_training BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_feedback_query_id ON public.query_feedback(query_id);
CREATE INDEX IF NOT EXISTS idx_query_feedback_rating ON public.query_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_query_feedback_reviewed ON public.query_feedback(reviewed);
CREATE INDEX IF NOT EXISTS idx_query_feedback_created_at ON public.query_feedback(created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────
-- RLS Policies
-- Access is currently handled at the API layer (service role key),
-- so RLS is disabled. If you later move to direct client access, enable
-- these and adjust the policies.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.query_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.query_feedback DISABLE ROW LEVEL SECURITY;

-- ─────────────────────────────────────────────────────────────────────────
-- Helpful view: bad_responses_for_review
-- Pulls together queries that got negative feedback, ready for weekly
-- review. Use this in the weekly improvement workflow.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.bad_responses_for_review AS
SELECT
  ql.id AS query_id,
  ql.query_text,
  ql.response_text,
  ql.trade,
  ql.confidence_score,
  ql.validation_issues,
  qf.rating,
  qf.user_comment,
  qf.created_at AS feedback_at,
  qf.reviewed
FROM public.query_log ql
INNER JOIN public.query_feedback qf ON qf.query_id = ql.id
WHERE qf.rating IN ('wrong', 'unclear')
  AND qf.reviewed = FALSE
ORDER BY qf.created_at DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- Helpful view: weekly_accuracy_summary
-- Rolling 7-day accuracy metric for Kyle's dashboard
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.weekly_accuracy_summary AS
SELECT
  ql.trade,
  COUNT(*) AS total_queries,
  COUNT(qf.id) FILTER (WHERE qf.rating = 'helpful') AS helpful_count,
  COUNT(qf.id) FILTER (WHERE qf.rating = 'wrong') AS wrong_count,
  COUNT(qf.id) FILTER (WHERE qf.rating = 'unclear') AS unclear_count,
  ROUND(
    100.0 * COUNT(qf.id) FILTER (WHERE qf.rating = 'helpful')::NUMERIC
    / NULLIF(COUNT(qf.id), 0),
    1
  ) AS accuracy_percentage
FROM public.query_log ql
LEFT JOIN public.query_feedback qf ON qf.query_id = ql.id
WHERE ql.created_at >= NOW() - INTERVAL '7 days'
GROUP BY ql.trade
ORDER BY total_queries DESC;

-- ─────────────────────────────────────────────────────────────────────────
-- Done
-- ─────────────────────────────────────────────────────────────────────────
