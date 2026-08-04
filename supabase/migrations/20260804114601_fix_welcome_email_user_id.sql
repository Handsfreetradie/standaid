-- Fix: the welcome-email trigger has posted profiles.id (the profile row's
-- own PK) instead of profiles.user_id (the actual auth.users id) since the
-- trigger was first written. welcome-email calls
-- supabase.auth.admin.getUserById(record.user_id) with that value, which
-- never matches a real auth user, so every call has 404'd
-- ("User not found") and no welcome email or admin signup notification has
-- ever actually sent. Confirmed via net._http_response: today's signup
-- logged exactly one call, status 404, body {"error":"User not found"}.
--
-- Fix is a one-field swap: NEW.id -> NEW.user_id. Everything else
-- (vault-based secrets, fail-closed behavior) is unchanged.

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
  SELECT decrypted_secret INTO anon_key FROM vault.decrypted_secrets WHERE name = 'anon_key';
  SELECT decrypted_secret INTO webhook_secret FROM vault.decrypted_secrets WHERE name = 'welcome_webhook_secret';

  IF anon_key IS NULL OR anon_key = '' OR webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING '[welcome-email] vault secrets not configured — skipping welcome email';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/welcome-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('user_id', NEW.user_id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[welcome-email] http_post failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
