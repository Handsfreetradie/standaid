import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Admin-only notification for signup lifecycle events, fired by two DB
// hooks (supabase/migrations/20260805123016_signup_status_notify.sql):
//  - handle_user_email_confirmed() trigger on auth.users (event: "confirmed")
//  - send_unconfirmed_signup_alerts() 6-hourly cron (event: "unconfirmed_24h")
// Both hooks pass the email straight from SQL rather than an id lookup —
// welcome-email got bitten once already by a getUserById 404 from a bad id,
// so this sidesteps that failure mode entirely.
//
// On "unconfirmed_24h" this also auto-resends the real Supabase signup
// confirmation email to the user (via auth.resend, same call the "Resend
// email" button on the sign-in screen makes) — not just an admin alert.

const FROM_EMAIL = "hello@standaid.ai";
const FROM_NAME = "StandAId";
const ADMIN_NOTIFY_EMAIL = "hello@standaid.ai";
const APP_URL = "https://app.standaid.ai";

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Fail-closed auth, same pattern as welcome-email/trial-reminder-email.
    const webhookSecret = Deno.env.get("WELCOME_EMAIL_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("[signup-status-notify] WELCOME_EMAIL_WEBHOOK_SECRET not set — refusing");
      return new Response(JSON.stringify({ error: "Service not configured" }), { status: 503 });
    }
    const incomingSecret = req.headers.get("x-webhook-secret");
    if (incomingSecret !== webhookSecret) {
      console.error("[signup-status-notify] Invalid or missing webhook secret");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const payload = await req.json();
    const record = payload?.record ?? payload;
    const { event, email } = record ?? {};
    if (!event || !email) {
      console.error("[signup-status-notify] Missing event/email:", JSON.stringify(payload));
      return new Response(JSON.stringify({ error: "Missing event or email" }), { status: 400 });
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[signup-status-notify] RESEND_API_KEY not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), { status: 500 });
    }

    let resendStatus: "sent" | "failed" | "skipped" = "skipped";
    if (event === "unconfirmed_24h") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
      if (supabaseUrl && anonKey) {
        try {
          const supabase = createClient(supabaseUrl, anonKey);
          const { error: resendError } = await supabase.auth.resend({
            type: "signup",
            email,
            options: { emailRedirectTo: APP_URL },
          });
          resendStatus = resendError ? "failed" : "sent";
          if (resendError) console.error("[signup-status-notify] auth.resend failed:", resendError.message);
        } catch (e) {
          resendStatus = "failed";
          console.error("[signup-status-notify] auth.resend threw:", e);
        }
      } else {
        console.error("[signup-status-notify] Missing SUPABASE_URL/SUPABASE_ANON_KEY — skipping resend");
      }
    }

    let subject: string;
    let text: string;
    if (event === "confirmed") {
      subject = `New StandAId signup confirmed: ${email}`;
      text = `Email confirmed and account activated:\n\nEmail: ${email}\nTime: ${new Date().toISOString()}`;
    } else if (event === "unconfirmed_24h") {
      const createdLabel = record.created_at ? new Date(record.created_at).toISOString() : "unknown";
      const resendLabel = resendStatus === "sent"
        ? "yes, resent automatically"
        : resendStatus === "failed"
        ? "attempted but failed — check function logs"
        : "not attempted (missing config)";
      subject = `StandAId signup never confirmed: ${email}`;
      text = `Signed up but hasn't confirmed their email after 24+ hours:\n\nEmail: ${email}\nSigned up: ${createdLabel}\nConfirmation email auto-resent: ${resendLabel}`;
    } else {
      console.error("[signup-status-notify] Unknown event:", event);
      return new Response(JSON.stringify({ error: "Unknown event" }), { status: 400 });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: [ADMIN_NOTIFY_EMAIL],
        subject,
        text,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.json().catch(() => null);
      console.error("[signup-status-notify] Resend error:", JSON.stringify(errBody));
      return new Response(JSON.stringify({ error: "Failed to send email", details: errBody }), { status: 500 });
    }

    const result = await emailRes.json();
    console.log(`[signup-status-notify] Sent ${event} notification for ${email}, id: ${result.id}${event === "unconfirmed_24h" ? `, resend: ${resendStatus}` : ""}`);

    return new Response(JSON.stringify({ ok: true, id: result.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[signup-status-notify] Unexpected error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500 });
  }
});
