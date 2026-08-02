-- Persist generated calculation and short-answer practice questions so
-- grading can use the server's copy of the question and model answer.
--
-- Previously grade_calculation / grade_short_answer took questionText,
-- modelAnswer and correctClause straight from the client request, so the AI
-- graded against whatever "rubric" the client sent — fabricated grading data
-- could earn full marks. MCQs were already persisted (capstone_questions);
-- this mirrors that for the other two question types.

CREATE TABLE public.capstone_practice_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  standard_id UUID REFERENCES public.standards(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('calculation', 'short_answer')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.capstone_practice_questions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own practice questions"
  ON public.capstone_practice_questions FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own practice questions"
  ON public.capstone_practice_questions FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE INDEX idx_practice_questions_user ON public.capstone_practice_questions (user_id, created_at DESC);
