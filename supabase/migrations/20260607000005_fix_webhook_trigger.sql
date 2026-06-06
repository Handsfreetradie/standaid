-- Replace the welcome-email trigger function to remove the hardcoded
-- webhook secret ('standaid-webhook-2026') that was baked into the
-- previous migration (20260519000002_welcome_email_trigger.sql).
--
-- The new function:
--   • Uses the anon key stored in app.settings.anon_key (a DB-level setting
--     set once via: ALTER DATABASE postgres SET app.settings.anon_key = '...')
--   • Falls back gracefully (returns NEW without calling the function) if the
--     setting hasn't been configured, so profile creation is never blocked.
--   • Sends only { user_id } — not the full profile row — to reduce the
--     surface area of data exposed over HTTP.
--
-- To configure the anon key (run once in the Supabase SQL editor):
--   ALTER DATABASE postgres SET app.settings.anon_key = '<your-anon-key>';
--
-- The welcome-email edge function should validate the JWT in the Authorization
-- header using Supabase's built-in JWT verification (standard Bearer flow),
-- rather than checking a custom x-webhook-secret header.

CREATE OR REPLACE FUNCTION public.handle_new_profile_welcome_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anon_key text;
BEGIN
  -- Retrieve the anon key from database-level settings.
  -- current_setting(..., true) returns NULL instead of raising if missing.
  anon_key := current_setting('app.settings.anon_key', true);

  -- If the key hasn't been set yet, skip silently — don't block profile creation.
  IF anon_key IS NULL OR anon_key = '' THEN
    RAISE WARNING '[welcome-email] app.settings.anon_key not configured — skipping welcome email';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/welcome-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key
    ),
    body := jsonb_build_object('user_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let email failure block profile creation
  RAISE WARNING '[welcome-email] http_post failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- The trigger itself is unchanged — just re-declare to be safe
DROP TRIGGER IF EXISTS on_profile_created_send_welcome ON public.profiles;

CREATE TRIGGER on_profile_created_send_welcome
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_profile_welcome_email();
