import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = "https://standaid-9mas.vercel.app";
const FROM_EMAIL = "hello@standaid.ai";
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
          <tr>
            <td style="background:#ffffff;padding:32px 40px;text-align:center;border-bottom:1px solid #f0f0f0;">
              <p style="margin:0;font-size:28px;font-weight:800;color:#1a1a2e;letter-spacing:-0.5px;">StandAId</p>
              <p style="margin:6px 0 0;font-size:13px;color:#888;letter-spacing:0.5px;">AUSTRALIAN STANDARDS AI ASSISTANT</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">G'day ${firstName} 👋</p>
              <p style="margin:0 0 24px;font-size:15px;color:#555;line-height:1.6;">
                Welcome to StandAId — your AI compliance assistant built for Australian tradies.
                You can now ask questions about your Australian Standards and get plain-English answers, fast.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
                <tr>
                  <td style="padding:14px 16px;background:#f8f8fc;border-radius:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="width:36px;vertical-align:top;padding-top:2px;"><span style="font-size:20px;">💬</span></td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:700;color:#1a1a2e;">AI Chat</p>
                          <p style="margin:2px 0 0;font-size:13px;color:#777;line-height:1.5;">Ask any compliance question and get clause-referenced answers in plain English.</p>
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
                        <td style="width:36px;vertical-align:top;padding-top:2px;"><span style="font-size:20px;">📚</span></td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:700;color:#1a1a2e;">Standards Library</p>
                          <p style="margin:2px 0 0;font-size:13px;color:#777;line-height:1.5;">Upload your AS/NZS PDFs and the AI cites exactly where each answer came from.</p>
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
                        <td style="width:36px;vertical-align:top;padding-top:2px;"><span style="font-size:20px;">🔧</span></td>
                        <td>
                          <p style="margin:0;font-size:14px;font-weight:700;color:#1a1a2e;">Onsite Tools</p>
                          <p style="margin:2px 0 0;font-size:13px;color:#777;line-height:1.5;">Calculators and reference tools built for the job site — voltage drop, cable sizing, and more.</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${APP_URL}" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;">Open StandAId →</a>
                  </td>
                </tr>
              </table>
              <p style="margin:28px 0 0;font-size:13px;color:#999;line-height:1.6;text-align:center;">
                You're on the <strong style="color:#555;">Pro plan</strong> during our beta — full access, no limits.<br/>
                If you've got feedback or run into anything, reply to this email.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f0f0f0;text-align:center;">
              <p style="margin:0;font-size:11px;color:#bbb;">StandAId · Australian Standards AI Assistant</p>
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
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  // Require webhook secret — ensures only an admin can trigger this
  const webhookSecret = Deno.env.get("WELCOME_EMAIL_WEBHOOK_SECRET");
  const incomingSecret = req.headers.get("x-webhook-secret");
  if (!webhookSecret || incomingSecret !== webhookSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  if (!RESEND_API_KEY) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not set" }), { status: 500 });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  // Fetch all users (paginated — handles up to 1000 users)
  const results: { email: string; status: string; id?: string; error?: string }[] = [];
  let page = 1;
  const perPage = 50;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error || !data?.users?.length) break;

    for (const user of data.users) {
      if (!user.email) continue;

      // Get display name from profile
      const { data: profile } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("user_id", user.id)
        .single();

      const displayName = profile?.display_name || user.email.split("@")[0];

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: [user.email],
            subject: "Welcome to StandAId 👋",
            html: buildWelcomeEmail(displayName),
          }),
        });

        const body = await res.json().catch(() => ({}));
        if (res.ok) {
          results.push({ email: user.email, status: "sent", id: body.id });
          console.log(`[backfill] Sent to ${user.email}`);
        } else {
          results.push({ email: user.email, status: "failed", error: JSON.stringify(body) });
          console.error(`[backfill] Failed for ${user.email}:`, body);
        }
      } catch (e: any) {
        results.push({ email: user.email, status: "error", error: e.message });
      }

      // Small delay to stay within Resend rate limits
      await new Promise((r) => setTimeout(r, 200));
    }

    if (data.users.length < perPage) break;
    page++;
  }

  const sent = results.filter(r => r.status === "sent").length;
  const failed = results.filter(r => r.status !== "sent").length;
  console.log(`[backfill] Done — ${sent} sent, ${failed} failed`);

  return new Response(JSON.stringify({ sent, failed, results }), {
    headers: { "Content-Type": "application/json" },
  });
});
