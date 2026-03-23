-- Add missing DELETE and UPDATE RLS policies for citations table
CREATE POLICY "Users can update own citations" ON public.citations FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.queries WHERE id = query_id AND user_id = auth.uid())
);

CREATE POLICY "Users can delete own citations" ON public.citations FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.queries WHERE id = query_id AND user_id = auth.uid())
);
