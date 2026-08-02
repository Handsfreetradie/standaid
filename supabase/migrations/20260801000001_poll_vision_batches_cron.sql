-- Polls in-flight Anthropic Message Batches (submitted by describe-figures)
-- and applies finished results. Most batches finish well under an hour, but
-- there's no fixed SLA, so this runs frequently and is a cheap no-op when
-- there's nothing to do (checks vision_batch_jobs first, most cron ticks
-- will find zero 'submitted' rows).
--
-- Same net.http_post + vault service_role_key pattern already in production
-- for resume-stalled-indexing (20260720010000_resume_stalled_indexing.sql).

CREATE OR REPLACE FUNCTION public.poll_vision_batches()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  key text;
  has_work boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM public.vision_batch_jobs WHERE status = 'submitted') INTO has_work;
  IF NOT has_work THEN
    RETURN;
  END IF;

  SELECT decrypted_secret INTO key FROM vault.decrypted_secrets WHERE name = 'service_role_key';
  IF key IS NULL OR key = '' THEN
    RAISE WARNING '[poll-vision-batches] vault secret "service_role_key" not set — skipping';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/poll-vision-batches',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || key),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[poll-vision-batches] failed: %', SQLERRM;
END;
$$;

REVOKE ALL ON FUNCTION public.poll_vision_batches() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule(
  'poll-vision-batches',
  '*/2 * * * *',
  'SELECT public.poll_vision_batches()'
);
