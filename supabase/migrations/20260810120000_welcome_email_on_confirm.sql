-- Move the "Welcome to StandAId" email from signup time (fired on profile
-- insert, before the user has even confirmed their email) to confirmation
-- time — it should read as "you're in and active," not arrive before the
-- account is even usable.
--
-- Folds into the existing on_auth_user_email_confirmed trigger
-- (20260805123016_signup_status_notify.sql) rather than adding a second
-- trigger on the same column transition, so admin-notify and user-welcome
-- both fire from one place, one http_post failure can't block the other
-- (each PERFORM is independent), and the whole function is still wrapped
-- in the same EXCEPTION WHEN OTHERS guard so a trigger failure never blocks
-- the actual email-confirmation UPDATE on auth.users.

DROP TRIGGER IF EXISTS on_profile_created_send_welcome ON public.profiles;
DROP FUNCTION IF EXISTS public.handle_new_profile_welcome_email();

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
  RAISE WARNING '[signup-status-notify] http_post failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- Trigger already exists and calls this function by name — no need to
-- recreate it, CREATE OR REPLACE FUNCTION above swaps the body in place.
