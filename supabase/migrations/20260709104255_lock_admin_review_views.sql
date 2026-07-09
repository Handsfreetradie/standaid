-- Security fix (advisor ERROR security_definer_view): the admin review views
-- bad_responses_for_review and weekly_accuracy_summary run as their owner and
-- bypass RLS on query_log/query_feedback, and PostgREST/GraphQL exposed them
-- to anon and authenticated — so anyone holding the public anon key could read
-- every user's question text, AI responses, and feedback comments.
--
-- Nothing in the app reads these views (checked src/ and functions/); they are
-- dashboard/admin-only. Make them security_invoker so they respect RLS, and
-- revoke client access entirely. The dashboard (postgres) and service_role
-- keep full access.

ALTER VIEW public.bad_responses_for_review SET (security_invoker = true);
ALTER VIEW public.weekly_accuracy_summary SET (security_invoker = true);

REVOKE ALL ON public.bad_responses_for_review FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.weekly_accuracy_summary FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.bad_responses_for_review TO service_role;
GRANT SELECT ON public.weekly_accuracy_summary TO service_role;
