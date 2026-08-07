-- Moves the admin "new signup" notification from signup time to email
-- confirmation time (an unconfirmed signup isn't a real user yet), and adds
-- a second alert for signups that never confirm within 24 hours.
--
-- Both hooks pass the email straight from the row being triggered on/queried
-- (NEW.email / u.email) rather than doing an admin.getUserById(user_id)
-- lookup in the edge function — the welcome-email trigger got bitten once
-- already by an id mismatch causing a 404 there (see
-- 20260804114601_fix_welcome_email_user_id.sql), so this sidesteps that
-- failure mode entirely.
--
-- Both call the new signup-status-notify edge function, reusing the same
-- vault secrets + net.http_post pattern as welcome-email/trial-reminder.

-- 1. Fire on email confirmation (auth.users.email_confirmed_at: null -> set)
CREATE OR REPLACE FUNCTION public.handle_user_email_confirmed()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anon_key text;
  webhook_secret text;
BEGIN
  SELECT decrypted_secret INTO anon_key FROM vault.decrypted_secrets WHERE name = 'anon_key';
  SELECT decrypted_secret INTO webhook_secret FROM vault.decrypted_secrets WHERE name = 'welcome_webhook_secret';

  IF anon_key IS NULL OR anon_key = '' OR webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING '[signup-status-notify] vault secrets not configured — skipping';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/signup-status-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('event', 'confirmed', 'email', NEW.email)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[signup-status-notify] http_post failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_confirmed ON auth.users;
CREATE TRIGGER on_auth_user_email_confirmed
  AFTER UPDATE OF email_confirmed_at ON auth.users
  FOR EACH ROW
  WHEN (OLD.email_confirmed_at IS NULL AND NEW.email_confirmed_at IS NOT NULL)
  EXECUTE FUNCTION public.handle_user_email_confirmed();

-- 2. Sweep every 6h: flag signups still unconfirmed 24h+ after creation.
-- Dedupe column mirrors profiles.pro_trial_reminder_sent_at — claimed via
-- UPDATE ... RETURNING so an overlapping/re-run cron can't double-alert.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS unconfirmed_signup_alert_sent_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.send_unconfirmed_signup_alerts()
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
    RAISE WARNING '[unconfirmed-signup-alert] vault secrets not configured — skipping';
    RETURN;
  END IF;

  FOR r IN
    UPDATE public.profiles p
    SET unconfirmed_signup_alert_sent_at = now()
    FROM auth.users u
    WHERE p.user_id = u.id
      AND u.email_confirmed_at IS NULL
      AND u.created_at < now() - interval '24 hours'
      AND p.unconfirmed_signup_alert_sent_at IS NULL
    RETURNING p.user_id, u.email, u.created_at
  LOOP
    BEGIN
      PERFORM net.http_post(
        url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/signup-status-notify',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || anon_key,
          'x-webhook-secret', webhook_secret
        ),
        body := jsonb_build_object(
          'event', 'unconfirmed_24h',
          'email', r.email,
          'created_at', r.created_at
        )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[unconfirmed-signup-alert] http_post failed for %: %', r.user_id, SQLERRM;
    END;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.send_unconfirmed_signup_alerts() FROM PUBLIC, anon, authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'send-unconfirmed-signup-alerts',
  '0 */6 * * *',
  'SELECT public.send_unconfirmed_signup_alerts()'
);
