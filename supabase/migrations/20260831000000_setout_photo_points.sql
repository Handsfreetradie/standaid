-- Photo points: a tradie drops a pin on the plan, takes a photo from that
-- spot, and it's stored for later reference (e.g. what was behind a wall
-- before it was closed up). Separate table from setout_fittings — a photo
-- point isn't an electrical fitting, it doesn't have a category/specs/circuit,
-- and its "position" is where the photo was taken from, not an item being
-- installed.

CREATE TABLE public.setout_photo_points (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES public.setout_plans(id) ON DELETE CASCADE NOT NULL,
  position JSONB NOT NULL,
  storage_path TEXT NOT NULL,
  -- Degrees clockwise from plan "up" (0-360), the direction the tradie was
  -- facing when the photo was taken. Null until set — see EditWallsFlow's
  -- sibling PhotoPointDialog, which prompts for it right after capture but
  -- doesn't require it.
  direction_degrees NUMERIC,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_setout_photo_points_plan ON public.setout_photo_points (plan_id);

ALTER TABLE public.setout_photo_points ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own setout photo points" ON public.setout_photo_points FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert own setout photo points" ON public.setout_photo_points FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can update own setout photo points" ON public.setout_photo_points FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can delete own setout photo points" ON public.setout_photo_points FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);

CREATE TRIGGER update_setout_photo_points_updated_at BEFORE UPDATE ON public.setout_photo_points
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Private storage bucket for the actual photo files — kept long-term (unlike
-- setout-plan-uploads, which is just AI-import source material), same
-- owner-scoped-folder pattern as audit-photos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('setout-photo-points', 'setout-photo-points', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "setout_photo_points_storage_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'setout-photo-points' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "setout_photo_points_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'setout-photo-points' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "setout_photo_points_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'setout-photo-points' AND auth.uid()::text = (storage.foldername(name))[1]);
