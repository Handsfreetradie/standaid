-- ─────────────────────────────────────────────────────────────────────────
-- StandAid Feedback & Query Log Schema
-- ─────────────────────────────────────────────────────────────────────────

-- Table 1: query_log
-- Records every query the AI handled. Referenced by query_feedback.

CREATE TABLE IF NOT EXISTS public.query_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  query_text TEXT NOT NULL,
  trade TEXT,
  standard_id UUID,

  response_text TEXT,

  retrieved_chunk_ids UUID[],
  retrieved_chunk_count INTEGER,

  confidence_score NUMERIC(3,2),
  validation_issues JSONB,
  needs_review BOOLEAN DEFAULT FALSE,

  model_used TEXT DEFAULT 'gpt-4o-mini',

  created_at TIMESTAMPTZ DEFAULT NOW(),
  response_time_ms INTEGER
);

CREATE INDEX IF NOT EXISTS idx_query_log_user_id ON public.query_log(user_id);
CREATE INDEX IF NOT EXISTS idx_query_log_created_at ON public.query_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_log_needs_review ON public.query_log(needs_review) WHERE needs_review = TRUE;
CREATE INDEX IF NOT EXISTS idx_query_log_trade ON public.query_log(trade);

-- Table 2: query_feedback
-- User's rating of a response.

CREATE TABLE IF NOT EXISTS public.query_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  query_id UUID NOT NULL REFERENCES public.query_log(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,

  rating TEXT NOT NULL CHECK (rating IN ('helpful', 'wrong', 'unclear')),

  user_comment TEXT,

  reviewed BOOLEAN DEFAULT FALSE,
  reviewed_at TIMESTAMPTZ,
  reviewer_notes TEXT,

  approved_for_training BOOLEAN DEFAULT FALSE,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_query_feedback_query_id ON public.query_feedback(query_id);
CREATE INDEX IF NOT EXISTS idx_query_feedback_rating ON public.query_feedback(rating);
CREATE INDEX IF NOT EXISTS idx_query_feedback_reviewed ON public.query_feedback(reviewed);
CREATE INDEX IF NOT EXISTS idx_query_feedback_created_at ON public.query_feedback(created_at DESC);

-- RLS disabled — access via service role key at the API layer
ALTER TABLE public.query_log DISABLE ROW LEVEL SECURITY;
ALTER TABLE public.query_feedback DISABLE ROW LEVEL SECURITY;

-- View: bad responses needing review
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

-- View: rolling 7-day accuracy summary
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
