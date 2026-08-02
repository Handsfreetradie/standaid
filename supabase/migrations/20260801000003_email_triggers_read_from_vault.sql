-- Fix: both the welcome-email and team-invite-email triggers read their
-- anon key / webhook secret via current_setting('app.settings...'), which
-- requires someone to have run `ALTER DATABASE postgres SET ...` once.
-- That step was never actually done (confirmed: current_setting returns
-- NULL for both in production), even though the values themselves were
-- safely provisioned in Vault — so both triggers have been silently
-- no-op'ing (RAISE WARNING + RETURN NEW) since the 2026-07-04 hardening
-- migration. No welcome emails, no invite emails, ever actually sent.
--
-- ALTER DATABASE SET also isn't available to this project's migration role
-- (permission denied), so rather than depend on a manual dashboard step,
-- both triggers now read straight from vault.decrypted_secrets — the exact
-- pattern already working in production for resume-stalled-indexing and
-- poll-vision-batches (SECURITY DEFINER is sufficient for vault access,
-- no extra grants needed).

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
    body := jsonb_build_object('user_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[welcome-email] http_post failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_org_member_invite_email()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  anon_key text;
  webhook_secret text;
BEGIN
  IF NEW.role <> 'member' THEN
    RETURN NEW;
  END IF;

  SELECT decrypted_secret INTO anon_key FROM vault.decrypted_secrets WHERE name = 'anon_key';
  SELECT decrypted_secret INTO webhook_secret FROM vault.decrypted_secrets WHERE name = 'welcome_webhook_secret';

  IF anon_key IS NULL OR anon_key = '' OR webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING '[team-invite-email] vault secrets not configured — skipping invite email';
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/team-invite-email',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || anon_key,
      'x-webhook-secret', webhook_secret
    ),
    body := jsonb_build_object('member_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING '[team-invite-email] http_post failed: %', SQLERRM;
  RETURN NEW;
END;
$$;
