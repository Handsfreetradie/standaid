-- Harden the welcome-email webhook.
--
-- Previously the trigger authenticated only with the public anon key, which
-- ships in the frontend — so anyone could call the welcome-email function,
-- send emails to real users, and enumerate valid user IDs.
--
-- The trigger now sends a shared secret as `x-webhook-secret`. The value lives
-- in a database-level setting (NOT hardcoded here), mirroring how the anon key
-- is already handled, so no secret is committed to git.
--
-- To enable welcome emails, run BOTH of these once (with the same random value):
--   1. In the Supabase SQL editor:
--        ALTER DATABASE postgres SET app.settings.welcome_webhook_secret = '<random-secret>';
--   2. In the welcome-email function's environment:
--        WELCOME_EMAIL_WEBHOOK_SECRET = '<same-random-secret>'
--
-- Until both are set the function fails closed (no emails sent), which is the
-- safe default — no unauthorized sends are possible.

CREATE OR REPLACE FUNCTION public.handle_new_profile_welcome_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anon_key text;
  webhook_secret text;
BEGIN
  anon_key := current_setting('app.settings.anon_key', true);
  webhook_secret := current_setting('app.settings.welcome_webhook_secret', true);

  -- Skip silently if not configured — never block profile creation.
  IF anon_key IS NULL OR anon_key = '' THEN
    RAISE WARNING '[welcome-email] app.settings.anon_key not configured — skipping welcome email';
    RETURN NEW;
  END IF;
  IF webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING '[welcome-email] app.settings.welcome_webhook_secret not configured — skipping welcome email';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/welcome-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('user_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[welcome-email] http_post failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_send_welcome ON public.profiles;

CREATE TRIGGER on_profile_created_send_welcome
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_profile_welcome_email();
