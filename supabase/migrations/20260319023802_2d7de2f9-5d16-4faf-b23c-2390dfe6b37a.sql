
-- Quiz questions generated from standards
CREATE TABLE public.capstone_questions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  standard_id UUID REFERENCES public.standards(id) ON DELETE CASCADE,
  question TEXT NOT NULL,
  options JSONB NOT NULL DEFAULT '[]',
  correct_answer TEXT NOT NULL,
  explanation TEXT,
  clause_reference TEXT,
  difficulty TEXT NOT NULL DEFAULT 'medium',
  topic TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Exam sessions
CREATE TABLE public.capstone_exams (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  title TEXT NOT NULL DEFAULT 'Practice Exam',
  total_questions INTEGER NOT NULL DEFAULT 0,
  correct_answers INTEGER NOT NULL DEFAULT 0,
  time_limit_seconds INTEGER,
  time_taken_seconds INTEGER,
  status TEXT NOT NULL DEFAULT 'in_progress',
  topic_breakdown JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Exam answers
CREATE TABLE public.capstone_exam_answers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  exam_id UUID NOT NULL REFERENCES public.capstone_exams(id) ON DELETE CASCADE,
  question_id UUID NOT NULL REFERENCES public.capstone_questions(id) ON DELETE CASCADE,
  user_answer TEXT,
  is_correct BOOLEAN NOT NULL DEFAULT false,
  answered_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Study guides
CREATE TABLE public.capstone_study_guides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  standard_id UUID REFERENCES public.standards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  topics JSONB DEFAULT '[]',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.capstone_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capstone_exams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capstone_exam_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.capstone_study_guides ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own questions" ON public.capstone_questions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own questions" ON public.capstone_questions FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own questions" ON public.capstone_questions FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own exams" ON public.capstone_exams FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own exams" ON public.capstone_exams FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own exams" ON public.capstone_exams FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own exams" ON public.capstone_exams FOR DELETE USING (auth.uid() = user_id);

CREATE POLICY "Users can view own exam answers" ON public.capstone_exam_answers FOR SELECT USING (EXISTS (SELECT 1 FROM public.capstone_exams WHERE id = capstone_exam_answers.exam_id AND user_id = auth.uid()));
CREATE POLICY "Users can insert own exam answers" ON public.capstone_exam_answers FOR INSERT WITH CHECK (EXISTS (SELECT 1 FROM public.capstone_exams WHERE id = capstone_exam_answers.exam_id AND user_id = auth.uid()));

CREATE POLICY "Users can view own study guides" ON public.capstone_study_guides FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own study guides" ON public.capstone_study_guides FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can delete own study guides" ON public.capstone_study_guides FOR DELETE USING (auth.uid() = user_id);
