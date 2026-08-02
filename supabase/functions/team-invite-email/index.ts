import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Notifies a teammate when a team owner adds them via Team.tsx's "Add a
// teammate" form (RPC add_org_member). Previously that RPC only inserted a
// DB row — nobody ever told the invited person, so team invites went
// nowhere unless the person happened to already know to sign up with that
// exact email. Mirrors the welcome-email function's auth/send pattern.

const APP_URL = "https://standaid-9mas.vercel.app";
const LOGO_URL = "https://standaid-9mas.vercel.app/pwa-192.png";
const FROM_EMAIL = "hello@standaid.ai";
const FROM_NAME = "StandAId";

function buildHtmlEmail(teamName: string, isNewAccount: boolean): string {
  const heading = isNewAccount
    ? `You've been invited to ${teamName}`
    : `You've been added to ${teamName}`;
  const body = isNewAccount
    ? `Sign up at StandAId with this email address and you'll automatically get shared access to <strong>${teamName}</strong>'s standards library — no separate invite code needed.`
    : `You now have shared access to <strong>${teamName}</strong>'s standards library on StandAId — every standard they've uploaded is searchable from your account.`;
  const cta = isNewAccount ? "Create your account →" : "Open StandAId →";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${heading}</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f0;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.10);">
          <tr>
            <td style="background:#121212;padding:28px 40px;text-align:center;">
              <img src="${LOGO_URL}" alt="StandAId" width="64" height="64" style="display:block;margin:0 auto 14px;border-radius:14px;" />
              <p style="margin:0;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">Stand<span style="color:#eb1414;">Ai</span>d</p>
              <p style="margin:6px 0 0;font-size:12px;color:#888;letter-spacing:0.8px;text-transform:uppercase;">Australian Standards AI Assistant</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">${heading} 👋</p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">${body}</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${APP_URL}" style="display:inline-block;background:#eb1414;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">${cta}</a>
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

function buildPlainTextEmail(teamName: string, isNewAccount: boolean): string {
  const body = isNewAccount
    ? `Sign up at StandAId with this email address and you'll automatically get shared access to ${teamName}'s standards library — no separate invite code needed.`
    : `You now have shared access to ${teamName}'s standards library on StandAId — every standard they've uploaded is searchable from your account.`;
  return `${isNewAccount ? `You've been invited to ${teamName}` : `You've been added to ${teamName}`}\n\n${body}\n\nOpen the app: ${APP_URL}\n\n---\nStandAId · Australian Standards AI Assistant\n`;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Same fail-closed shared-secret pattern as welcome-email — reuses the
    // already-configured app.settings.welcome_webhook_secret rather than
    // provisioning a second secret for the same DB-trigger-to-function
    // handshake.
    const webhookSecret = Deno.env.get("WELCOME_EMAIL_WEBHOOK_SECRET");
    if (!webhookSecret) {
      console.error("[team-invite-email] WELCOME_EMAIL_WEBHOOK_SECRET not set — refusing");
      return new Response(JSON.stringify({ error: "Service not configured" }), { status: 503 });
    }
    const incomingSecret = req.headers.get("x-webhook-secret");
    if (incomingSecret !== webhookSecret) {
      console.error("[team-invite-email] Invalid or missing webhook secret");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
    }

    const payload = await req.json();
    const record = payload?.record ?? payload;
    if (!record?.member_id) {
      console.error("[team-invite-email] No member_id in payload:", JSON.stringify(payload));
      return new Response(JSON.stringify({ error: "No member_id" }), { status: 400 });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: member, error: memberError } = await supabase
      .from("organization_members")
      .select("invited_email, status, organization_id")
      .eq("id", record.member_id)
      .single();
    if (memberError || !member) {
      console.error("[team-invite-email] Member not found:", memberError?.message);
      return new Response(JSON.stringify({ error: "Member not found" }), { status: 404 });
    }

    const { data: org, error: orgError } = await supabase
      .from("organizations")
      .select("name")
      .eq("id", member.organization_id)
      .single();
    if (orgError || !org) {
      console.error("[team-invite-email] Organization not found:", orgError?.message);
      return new Response(JSON.stringify({ error: "Organization not found" }), { status: 404 });
    }

    const isNewAccount = member.status !== "active";
    const teamName = org.name || "your team";

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[team-invite-email] RESEND_API_KEY not set");
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
        to: [member.invited_email],
        subject: isNewAccount ? `You've been invited to ${teamName} on StandAId` : `You've been added to ${teamName} on StandAId`,
        html: buildHtmlEmail(teamName, isNewAccount),
        text: buildPlainTextEmail(teamName, isNewAccount),
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.json().catch(() => null);
      console.error("[team-invite-email] Resend error:", JSON.stringify(errBody));
      return new Response(JSON.stringify({ error: "Failed to send email", details: errBody }), { status: 500 });
    }

    const result = await emailRes.json();
    console.log(`[team-invite-email] Sent to ${member.invited_email}, id: ${result.id}`);

    return new Response(JSON.stringify({ ok: true, id: result.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("[team-invite-email] Unexpected error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500 });
  }
});
