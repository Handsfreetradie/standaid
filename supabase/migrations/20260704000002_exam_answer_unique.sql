-- Prevent duplicate exam answers inflating scores.
--
-- submit_answer tries to update an existing answer on a double-tap, but
-- capstone_exam_answers has no UPDATE RLS policy, so under the user-scoped
-- client the update silently no-ops and a duplicate row is inserted instead —
-- inflating the exam's total_questions and skewing the percentage.
--
-- A unique constraint makes one answer per (exam, question) a hard guarantee
-- regardless of RLS, and lets the edge function use upsert cleanly.

-- Collapse any pre-existing duplicates first (keep the earliest answer).
DELETE FROM public.capstone_exam_answers a
USING public.capstone_exam_answers b
WHERE a.exam_id = b.exam_id
  AND a.question_id = b.question_id
  AND a.ctid > b.ctid;

ALTER TABLE public.capstone_exam_answers
  ADD CONSTRAINT capstone_exam_answers_exam_question_unique
  UNIQUE (exam_id, question_id);
