-- Tracks an in-flight Anthropic Message Batch across the async gap between
-- edge function invocations (submitting a batch and polling/applying its
-- results happen in separate, stateless function calls, so the batch id and
-- the chunk mapping have to live somewhere in between).
--
-- describe-figures used to fire one synchronous Sonnet vision call per
-- figure/table at full price. It now submits all of a standard's primary-page
-- vision requests as a single Anthropic Batch (50% cheaper), recording the
-- batch id + item map here; poll-vision-batches picks it up, applies results,
-- and runs the small retry/continuation tail on the existing synchronous path.

CREATE TABLE public.vision_batch_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  standard_id UUID NOT NULL REFERENCES public.standards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  batch_id TEXT NOT NULL,
  items JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'applied')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_vision_batch_jobs_status ON public.vision_batch_jobs (status);
CREATE INDEX idx_vision_batch_jobs_standard ON public.vision_batch_jobs (standard_id);

-- Service-role only — this table is written and read exclusively by
-- describe-figures / poll-vision-batches, never by client requests.
ALTER TABLE public.vision_batch_jobs ENABLE ROW LEVEL SECURITY;
