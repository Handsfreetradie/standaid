-- Voice notes: a tradie records a quick spoken note during a customer
-- walkthrough (general narration about the job, not pinned to one spot on
-- the plan, unlike a photo point) and it gets transcribed server-side via
-- Deepgram (supabase/functions/transcribe-setout-voice-note). Same
-- ownership-via-parent-plan RLS pattern as setout_photo_points, but this
-- bucket sets file_size_limit/allowed_mime_types (setout-plan-exports'
-- pattern) — a recording is a real per-use transcription cost, so the size
-- cap plus the client-side max-duration cap (see the recording UI) bound
-- the worst case per note.

CREATE TABLE public.setout_voice_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id UUID REFERENCES public.setout_plans(id) ON DELETE CASCADE NOT NULL,
  storage_path TEXT NOT NULL,
  -- The container MediaRecorder actually produced client-side — varies by
  -- browser (audio/webm on Chrome/Android, audio/mp4 on iOS Safari) — the
  -- transcription edge function needs the real value to send Deepgram a
  -- correct Content-Type, not a guess.
  content_type TEXT NOT NULL DEFAULT 'audio/webm',
  duration_seconds NUMERIC,
  transcript TEXT,
  -- pending: uploaded, not yet sent for transcription
  -- transcribing: sent to Deepgram, awaiting the result
  -- done / failed: terminal states
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'transcribing', 'done', 'failed')),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX idx_setout_voice_notes_plan ON public.setout_voice_notes (plan_id);

ALTER TABLE public.setout_voice_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own setout voice notes" ON public.setout_voice_notes FOR SELECT USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can insert own setout voice notes" ON public.setout_voice_notes FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can update own setout voice notes" ON public.setout_voice_notes FOR UPDATE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);
CREATE POLICY "Users can delete own setout voice notes" ON public.setout_voice_notes FOR DELETE USING (
  EXISTS (SELECT 1 FROM public.setout_plans WHERE id = plan_id AND user_id = auth.uid())
);

CREATE TRIGGER update_setout_voice_notes_updated_at BEFORE UPDATE ON public.setout_voice_notes
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Private, owner-scoped-folder bucket, same as setout-photo-points, but with
-- a size cap and a narrow mime allowlist — the two container formats a
-- browser's MediaRecorder actually produces (webm/opus on Chrome/Android,
-- mp4/AAC on iOS Safari), plus ogg as a fallback.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'setout-voice-notes',
  'setout-voice-notes',
  false,
  26214400, -- 25MB — comfortably covers a 20-minute recording (see the client's hard auto-stop) at typical voice bitrates
  ARRAY['audio/webm', 'audio/mp4', 'audio/ogg']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "setout_voice_notes_storage_select" ON storage.objects FOR SELECT
  USING (bucket_id = 'setout-voice-notes' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "setout_voice_notes_storage_insert" ON storage.objects FOR INSERT
  WITH CHECK (bucket_id = 'setout-voice-notes' AND auth.uid()::text = (storage.foldername(name))[1]);
CREATE POLICY "setout_voice_notes_storage_delete" ON storage.objects FOR DELETE
  USING (bucket_id = 'setout-voice-notes' AND auth.uid()::text = (storage.foldername(name))[1]);
