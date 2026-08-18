import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Fired by the daily send_trial_ending_reminders() cron
// (supabase/migrations/20260804130000_trial_reminder_cron.sql) 3 days before
// a free Pro trial (profiles.pro_expires_at) reverts someone to Free.
// Mirrors welcome-email's auth/send pattern: DB trigger posts a shared
// secret, this function verifies it, looks up the user, sends via Resend.

const APP_URL = "https://app.standaid.ai";
const LOGO_URL = "https://app.standaid.ai/pwa-192.png";
const FROM_EMAIL = "hello@standaid.ai";
const FROM_NAME = "StandAId";

function buildHtmlEmail(firstName: string, expiresLabel: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your StandAId Pro trial ends soon</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">
          <tr>
            <td style="background:#ffffff;padding:28px 40px;text-align:center;border-bottom:1px solid #f0f0f0;">
              <img src="${LOGO_URL}" alt="StandAId" width="64" height="64" style="display:block;margin:0 auto 14px;border-radius:14px;" />
              <p style="margin:0;font-size:28px;font-weight:800;color:#1a1a2e;letter-spacing:-0.5px;">Stand<span style="color:#eb1414;">Ai</span>d</p>
              <p style="margin:6px 0 0;font-size:12px;color:#888;letter-spacing:0.8px;text-transform:uppercase;">Australian Standards AI Assistant</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">G'day ${firstName} 👋</p>
              <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
                Your free Pro access to StandAId ends on <strong>${expiresLabel}</strong>. After that you'll drop
                back to the Free plan — limited standards, limited daily queries.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
                Keep unlimited standards, full indexing and 1,000 queries/month by upgrading to Pro now —
                just $9.99/month, cancel anytime.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${APP_URL}/profile" style="display:inline-block;background:#eb1414;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">Upgrade to Pro →</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f0f0f0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;">StandAId · Australian Standards AI Assistant</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPlainTextEmail(firstName: string, expiresLabel: string): string {
  return `G'day ${firstName},

Your free Pro access to StandAId ends on ${expiresLabel}. After that you'll drop back to the Free plan — limited standards, limited daily queries.

Keep unlimited standards, full indexing and 1,000 queries/month by upgrading to Pro now — just $9.99/month, cancel anytime.

Upgrade: ${APP_URL}/profile

---
StandAId · Australian Standards AI Assistant
`;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Fail-closed auth, same as welcome-email: the anon key alone (which
    // ships in the frontend) is not sufficient — require the shared secret
    // that only the DB trigger and this function know.
    const webhookSecret = Deno.env.get("WELCOME_EMAIL_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("[trial-reminder-email] WELCOME_EMAIL_WEBHOOK_SECRET not set — refusing");
      return new Response(JSON.stringify({ error: "Service not configured" }), { status: 503 });
    }
    const incomingSecret = req.headers.get("x-webhook-secret");
    if (incomingSecret !== webhookSecret) {
      console.error("[trial-reminder-email] Invalid or missing webhook secret");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const payload = await req.json();
    const record = payload?.record ?? payload;
    if (!record?.user_id || !record?.pro_expires_at) {
      console.error("[trial-reminder-email] Missing user_id/pro_expires_at:", JSON.stringify(payload));
      return new Response(JSON.stringify({ error: "Missing user_id or pro_expires_at" }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(record.user_id);
    if (userError || !userData?.user?.email) {
      console.error("[trial-reminder-email] Could not fetch user email:", userError?.message);
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
    }

    const email = userData.user.email;
    const { data: profileRow } = await supabase
      .from("profiles").select("display_name").eq("user_id", record.user_id).maybeSingle();
    const firstName = (profileRow?.display_name || email.split("@")[0]).split(" ")[0];
    const expiresLabel = new Date(record.pro_expires_at).toLocaleDateString("en-AU", {
      day: "numeric", month: "long", year: "numeric",
    });

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[trial-reminder-email] RESEND_API_KEY not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), { status: 500 });
    }

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        reply_to: FROM_EMAIL,
        to: [email],
        subject: "Your StandAId Pro trial ends in 3 days",
        html: buildHtmlEmail(firstName, expiresLabel),
        text: buildPlainTextEmail(firstName, expiresLabel),
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.json().catch(() => null);
      console.error("[trial-reminder-email] Resend error:", JSON.stringify(errBody));
      return new Response(JSON.stringify({ error: "Failed to send email", details: errBody }), { status: 500 });
    }

    const result = await emailRes.json();
    console.log(`[trial-reminder-email] Sent to ${email}, id: ${result.id}`);

    return new Response(JSON.stringify({ ok: true, id: result.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[trial-reminder-email] Unexpected error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500 });
  }
});
