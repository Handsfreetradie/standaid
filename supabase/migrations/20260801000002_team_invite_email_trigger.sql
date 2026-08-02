-- Send an email when a team owner adds a teammate (Team.tsx's "Add a
-- teammate" form → add_org_member RPC). That RPC only ever inserted a DB
-- row — nobody told the invited person, so invites went nowhere unless they
-- happened to already know to sign up with that exact email.
--
-- Fires for 'member' rows only (role default), so it never fires for the
-- 'owner' row the stripe-webhook inserts when a team is first created —
-- the owner doesn't need an "invite" email to their own team.
--
-- Reuses the same fail-closed shared-secret pattern already configured for
-- welcome-email (app.settings.anon_key / app.settings.welcome_webhook_secret)
-- — no new secret to provision.

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

  anon_key := current_setting('app.settings.anon_key', true);
  webhook_secret := current_setting('app.settings.welcome_webhook_secret', true);

  IF anon_key IS NULL OR anon_key = '' OR webhook_secret IS NULL OR webhook_secret = '' THEN
    RAISE WARNING '[team-invite-email] app.settings not configured — skipping invite email';
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

DROP TRIGGER IF EXISTS on_org_member_added_send_invite ON public.organization_members;

CREATE TRIGGER on_org_member_added_send_invite
  AFTER INSERT ON public.organization_members
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_org_member_invite_email();
