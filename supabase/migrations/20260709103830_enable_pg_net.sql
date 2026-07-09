-- pg_net was never enabled on this project, so the welcome-email trigger's
-- net.http_post call has always failed ("schema net does not exist") and been
-- swallowed by the trigger's exception handler — no email ever sent.
-- The extension creates its own "net" schema.

CREATE EXTENSION IF NOT EXISTS pg_net;
