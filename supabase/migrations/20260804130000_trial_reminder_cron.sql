-- Daily cron: warn anyone on a free Pro trial 3 days before it reverts them
-- to Free (profiles.pro_expires_at), pushing them to upgrade before losing
-- access. Reuses the same vault secrets + net.http_post pattern already
-- used by welcome-email/team-invite-email triggers.
--
-- Claims rows via UPDATE ... RETURNING (sets pro_trial_reminder_sent_at
-- before sending) so a second cron run — or an overlapping run — can never
-- send the same person the reminder twice.

CREATE OR REPLACE FUNCTION public.send_trial_ending_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anon_key text;
  webhook_secret text;
  r RECORD;
BEGIN
  SELECT decrypted_secret INTO anon_key FROM vault.decrypted_secrets WHERE name = 'anon_key';
  SELECT decrypted_secret INTO webhook_secret FROM vault.decrypted_secrets WHERE name = 'welcome_webhook_secret';

  IF anon_key IS NULL OR anon_key = '' OR webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING '[trial-reminder] vault secrets not configured — skipping';
    RETURN;
  END IF;

  FOR r IN
    UPDATE public.profiles
    SET pro_trial_reminder_sent_at = now()
    WHERE subscription_tier = 'pro'
      AND pro_expires_at IS NOT NULL
      AND pro_expires_at BETWEEN now() AND now() + interval '3 days'
      AND pro_trial_reminder_sent_at IS NULL
    RETURNING user_id, pro_expires_at
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/trial-reminder-email',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || anon_key,
          'x-webhook-secret', webhook_secret
        ),
        body := jsonb_build_object('user_id', r.user_id, 'pro_expires_at', r.pro_expires_at)
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[trial-reminder] http_post failed for %: %', r.user_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.send_trial_ending_reminders() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'send-trial-ending-reminders',
  '0 22 * * *',
  'SELECT public.send_trial_ending_reminders()'
);
