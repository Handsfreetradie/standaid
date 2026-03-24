-- Track AI usage for capstone rate limiting (20 calls per hour per user)
CREATE TABLE public.capstone_usage (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.capstone_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own usage" ON public.capstone_usage FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own usage" ON public.capstone_usage FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Index for fast per-user hourly count queries
CREATE INDEX capstone_usage_user_created ON public.capstone_usage (user_id, created_at);
