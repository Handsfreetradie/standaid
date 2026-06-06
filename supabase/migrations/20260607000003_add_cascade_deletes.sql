-- Add ON DELETE CASCADE to user_id foreign keys that reference auth.users.
-- Without cascades, deleting a user from auth.users leaves orphan rows
-- (or fails outright if a NOT NULL constraint exists).
-- Each block checks the table exists before touching constraints, so this
-- migration is safe to run even if some tables don't exist in a given env.

-- ── capstone_questions ─────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'capstone_questions'
  ) THEN
    ALTER TABLE public.capstone_questions
      DROP CONSTRAINT IF EXISTS capstone_questions_user_id_fkey;
    ALTER TABLE public.capstone_questions
      ADD CONSTRAINT capstone_questions_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── capstone_exams ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'capstone_exams'
  ) THEN
    ALTER TABLE public.capstone_exams
      DROP CONSTRAINT IF EXISTS capstone_exams_user_id_fkey;
    ALTER TABLE public.capstone_exams
      ADD CONSTRAINT capstone_exams_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── capstone_study_guides ──────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'capstone_study_guides'
  ) THEN
    ALTER TABLE public.capstone_study_guides
      DROP CONSTRAINT IF EXISTS capstone_study_guides_user_id_fkey;
    ALTER TABLE public.capstone_study_guides
      ADD CONSTRAINT capstone_study_guides_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── capstone_usage ─────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'capstone_usage'
  ) THEN
    ALTER TABLE public.capstone_usage
      DROP CONSTRAINT IF EXISTS capstone_usage_user_id_fkey;
    ALTER TABLE public.capstone_usage
      ADD CONSTRAINT capstone_usage_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── processing_jobs ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'processing_jobs'
  ) THEN
    ALTER TABLE public.processing_jobs
      DROP CONSTRAINT IF EXISTS processing_jobs_user_id_fkey;
    ALTER TABLE public.processing_jobs
      ADD CONSTRAINT processing_jobs_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── standard_figures ───────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'standard_figures'
  ) THEN
    ALTER TABLE public.standard_figures
      DROP CONSTRAINT IF EXISTS standard_figures_user_id_fkey;
    ALTER TABLE public.standard_figures
      ADD CONSTRAINT standard_figures_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;

-- ── standard_tables ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'standard_tables'
  ) THEN
    ALTER TABLE public.standard_tables
      DROP CONSTRAINT IF EXISTS standard_tables_user_id_fkey;
    ALTER TABLE public.standard_tables
      ADD CONSTRAINT standard_tables_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;
  END IF;
END $$;
