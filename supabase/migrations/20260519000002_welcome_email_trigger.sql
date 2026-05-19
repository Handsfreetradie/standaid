-- Trigger welcome email via Resend when a new user profile is created.
-- Uses pg_net (always enabled on Supabase) for an async fire-and-forget HTTP call.
-- The edge function is called with a payload matching the Supabase webhook format.

CREATE OR REPLACE FUNCTION public.handle_new_profile_welcome_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM net.http_post(
    url     := 'https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/welcome-email',
    headers := jsonb_build_object(
      'Content-Type',      'application/json',
      'Authorization',     'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind5eGVxa2dwd2tjY2t5bnRxY25zIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyMzc4NzUsImV4cCI6MjA4OTgxMzg3NX0.vA_ZhRkgmrOgTIwT4_C-tEEQ81Mf4AvuyTD9Yety2Ao',
      'x-webhook-secret',  'standaid-webhook-2026'
    ),
    body := jsonb_build_object(
      'type',   'INSERT',
      'table',  'profiles',
      'schema', 'public',
      'record', row_to_json(NEW)::jsonb
    )
  );
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Never let email failure block profile creation
  RAISE WARNING '[welcome-email] http_post failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_profile_created_send_welcome ON public.profiles;

CREATE TRIGGER on_profile_created_send_welcome
  AFTER INSERT ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_profile_welcome_email();
