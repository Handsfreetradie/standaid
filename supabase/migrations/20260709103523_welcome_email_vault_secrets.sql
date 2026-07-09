-- Welcome-email config moves from database settings to Supabase Vault.
--
-- The previous design (20260704000000) read the anon key and webhook secret
-- from app.settings.* database parameters, but this project denies
-- ALTER DATABASE ... SET even to the dashboard SQL editor role
-- ("permission denied to set parameter"), so those settings could never be
-- configured. Vault is the supported place for secrets readable from SQL.
--
-- To enable welcome emails, store both secrets once (SQL editor or CLI):
--   SELECT vault.create_secret('<anon key>', 'anon_key');
--   SELECT vault.create_secret('<random secret>', 'welcome_webhook_secret');
-- and set the welcome-email function secret WELCOME_EMAIL_WEBHOOK_SECRET to
-- the same random value. Until both exist the trigger skips silently
-- (fails closed) — profile creation is never blocked.

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
  SELECT decrypted_secret INTO anon_key
  FROM vault.decrypted_secrets
  WHERE name = 'anon_key';

  SELECT decrypted_secret INTO webhook_secret
  FROM vault.decrypted_secrets
  WHERE name = 'welcome_webhook_secret';

  -- Skip silently if not configured — never block profile creation.
  IF anon_key IS NULL OR anon_key = '' THEN
    RAISE WARNING '[welcome-email] vault secret "anon_key" not set — skipping welcome email';
    RETURN NEW;
  END IF;
  IF webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING '[welcome-email] vault secret "welcome_webhook_secret" not set — skipping welcome email';
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

-- Trigger unchanged — re-declare to be safe.
DROP TRIGGER IF EXISTS on_profile_created_send_welcome ON public.profiles;

CREATE TRIGGER on_profile_created_send_welcome
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_profile_welcome_email();
