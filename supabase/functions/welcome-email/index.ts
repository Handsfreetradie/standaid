import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = "https://standaid-9mas.vercel.app";
const FROM_EMAIL = "noreply@standaid.com.au";
const FROM_NAME = "StandAId";

function buildWelcomeEmail(name: string): string {
  const firstName = name?.split(" ")[0] || "there";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to StandAId</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#1a1a2e;padding:32px 40px;text-align:center;">
              <p style="margin:0;font-size:28px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">StandAId</p>
              <p style="margin:6px 0 0;font-size:13px;color:#a0a0c0;letter-spacing:0.5px;">AUSTRALIAN STANDARDS AI ASSISTANT</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">G'day ${firstName} 👋</p>
              <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
                Welcome to StandAId — your AI compliance assistant built for Australian tradies.
                You can now ask questions about your Australian Standards and get plain-English answers, fast.
              </p>

              <!-- Features -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:14px 16px;background:#f8f8fc;border-radius:8px;margin-bottom:8px;display:block;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:36px;vertical-align:top;padding-top:2px;">
                          <span style="font-size:20px;">💬</span>
                        </td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:700;color:#1a1a2e;">AI Chat</p>
                          <p style="margin:2px 0 0;font-size:13px;color:#777;line-height:1.5;">Ask any compliance question and get clause-referenced answers in plain English — no more digging through 600-page documents.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px;background:#f8f8fc;border-radius:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:36px;vertical-align:top;padding-top:2px;">
                          <span style="font-size:20px;">📚</span>
                        </td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:700;color:#1a1a2e;">Standards Library</p>
                          <p style="margin:2px 0 0;font-size:13px;color:#777;line-height:1.5;">Upload your AS/NZS PDFs and StandAId indexes every clause so the AI can cite exactly where the answer came from.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr><td style="height:8px;"></td></tr>
                <tr>
                  <td style="padding:14px 16px;background:#f8f8fc;border-radius:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:36px;vertical-align:top;padding-top:2px;">
                          <span style="font-size:20px;">🔧</span>
                        </td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:700;color:#1a1a2e;">Onsite Tools</p>
                          <p style="margin:2px 0 0;font-size:13px;color:#777;line-height:1.5;">Handy calculators and reference tools built for the job site — voltage drop, cable sizing, and more.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- CTA -->
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${APP_URL}" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">Open StandAId →</a>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0;font-size:13px;color:#999;line-height:1.6;text-align:center;">
                You're on the <strong style="color:#555;">Pro plan</strong> during our beta — full access, no limits.<br/>
                If you've got feedback or run into anything, reply to this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f0f0f0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;">StandAId · Australian Standards AI Assistant · Perth, WA</p>
              <p style="margin:4px 0 0;font-size:11px;color:#bbb;">Always verify AI answers against the original standard before relying on them on the job.</p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

serve(async (req) => {
  // Only accept POST
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    // Verify webhook secret to ensure this is a legitimate Supabase webhook
    const webhookSecret = Deno.env.get("WELCOME_EMAIL_WEBHOOK_SECRET");
    if (webhookSecret) {
      const incomingSecret = req.headers.get("x-webhook-secret");
      if (incomingSecret !== webhookSecret) {
        console.error("[welcome-email] Invalid webhook secret");
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
      }
    }

    const payload = await req.json();

    // Supabase Database Webhook payload shape: { type, table, schema, record, old_record }
    const record = payload?.record;
    if (!record?.user_id) {
      console.error("[welcome-email] No user_id in payload:", JSON.stringify(payload));
      return new Response(JSON.stringify({ error: "No user_id" }), { status: 400 });
    }

    const userId = record.user_id;

    // Use service role to look up the user's email from auth.users
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(userId);
    if (userError || !userData?.user?.email) {
      console.error("[welcome-email] Could not fetch user email:", userError?.message);
      return new Response(JSON.stringify({ error: "User not found" }), { status: 404 });
    }

    const email = userData.user.email;
    const displayName = record.display_name || email.split("@")[0];

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[welcome-email] RESEND_API_KEY not set");
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
        to: [email],
        subject: "Welcome to StandAId 👋",
        html: buildWelcomeEmail(displayName),
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.json().catch(() => null);
      console.error("[welcome-email] Resend error:", JSON.stringify(errBody));
      return new Response(JSON.stringify({ error: "Failed to send email", details: errBody }), { status: 500 });
    }

    const result = await emailRes.json();
    console.log(`[welcome-email] Sent to ${email}, id: ${result.id}`);
    return new Response(JSON.stringify({ ok: true, id: result.id }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[welcome-email] Unexpected error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500 });
  }
});
