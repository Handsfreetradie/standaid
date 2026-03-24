-- Add missing UPDATE policies for capstone tables
CREATE POLICY "Users can update own questions" ON public.capstone_questions FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can update own study guides" ON public.capstone_study_guides FOR UPDATE USING (auth.uid() = user_id);
