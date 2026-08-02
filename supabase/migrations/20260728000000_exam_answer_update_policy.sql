-- Allow users to change an exam answer they already submitted.
--
-- submit_answer upserts on (exam_id, question_id), but capstone_exam_answers
-- only has SELECT and INSERT policies — with no UPDATE policy, RLS
-- default-denies the ON CONFLICT DO UPDATE branch, so a corrected answer is
-- silently discarded and the original kept.

CREATE POLICY "Users can update own exam answers"
  ON public.capstone_exam_answers FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.capstone_exams WHERE id = capstone_exam_answers.exam_id AND user_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.capstone_exams WHERE id = capstone_exam_answers.exam_id AND user_id = auth.uid()));
