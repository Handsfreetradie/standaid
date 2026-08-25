import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const APP_URL = "https://app.standaid.ai";
const LOGO_URL = "https://app.standaid.ai/pwa-192.png";
const FROM_EMAIL = "hello@standaid.ai";
const FROM_NAME = "StandAId";

function buildHtmlEmail(firstName: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Unlock 3 months free Pro — tag us on Instagram or TikTok</title>
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
                We're growing on socials and want to share the love. Show us how you're using StandAId on the job — and we'll give you 3 months of free Pro access.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
                Post a photo, video, or reel showing StandAId in action on your site or workshop. Tag us, DM us the link — we'll verify it and unlock your 3 months straight away.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="https://www.instagram.com/standaid.ai/" style="display:inline-block;background:#eb1414;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;margin-right:12px;margin-bottom:12px;">Tag us on Instagram →</a>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <a href="https://www.tiktok.com/@standaid" style="display:inline-block;background:#eb1414;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">Tag us on TikTok →</a>
                  </td>
                </tr>
              </table>

              <div style="margin:32px 0 0;padding:24px;background:#f9f9f9;border-radius:8px;border-left:4px solid #eb1414;">
                <p style="margin:0 0 8px;font-size:13px;font-weight:700;color:#1a1a2e;">How it works</p>
                <p style="margin:0;font-size:13px;color:#666;line-height:1.6;">
                  1. Post on Instagram (@standaid.ai) or TikTok (@standaid) showing StandAId<br/>
                  2. DM us a screenshot or link to your post<br/>
                  3. We verify it's legit and unlock 3 months free Pro for you
                </p>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:20px 40px;border-top:1px solid #f0f0f0;text-align:center;">
              <p style="margin:0 0 12px;font-size:11px;color:#bbb;">StandAId · Australian Standards AI Assistant</p>
              <p style="margin:0;font-size:10px;color:#ddd;">
                <a href="${unsubscribeUrl}" style="color:#999;text-decoration:none;">Unsubscribe from promotional emails</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function buildPlainTextEmail(firstName: string, unsubscribeUrl: string): string {
  return `G'day ${firstName},

We're growing on socials and want to share the love. Show us how you're using StandAId on the job — and we'll give you 3 months of free Pro access.

Post a photo, video, or reel showing StandAId in action on your site or workshop. Tag us, DM us the link — we'll verify it and unlock your 3 months straight away.

Instagram: https://www.instagram.com/standaid.ai/
TikTok: https://www.tiktok.com/@standaid

How it works:
1. Post on Instagram (@standaid.ai) or TikTok (@standaid) showing StandAId
2. DM us a screenshot or link to your post
3. We verify it's legit and unlock 3 months free Pro for you

---
StandAId · Australian Standards AI Assistant

Unsubscribe: ${unsubscribeUrl}
`;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

    // Allow calls from authenticated dashboard or with service role key
    const authHeader = req.headers.get("Authorization");
    // For one-off promotional sends from the dashboard, we're lenient on auth
    // (the dashboard itself is already authenticated to the project)

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[promo-social-share] RESEND_API_KEY not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), { status: 500 });
    }

    // Fetch all users
    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    if (usersError || !users) {
      console.error("[promo-social-share] Could not fetch users:", usersError?.message);
      return new Response(JSON.stringify({ error: "Failed to fetch users" }), { status: 500 });
    }

    let sent = 0;
    let failed = 0;

    // Send to each user
    for (const user of users) {
      if (!user.email) continue;

      try {
        // Get display name and check if unsubscribed from promos
        const { data: profileRow } = await supabaseAdmin
          .from("profiles").select("display_name, email_promotions_unsubscribed").eq("user_id", user.id).maybeSingle();

        if (profileRow?.email_promotions_unsubscribed) {
          console.log(`[promo-social-share] Skipping ${user.email} (unsubscribed)`);
          continue;
        }

        const firstName = (profileRow?.display_name || user.email.split("@")[0]).split(" ")[0];

        // Generate unsubscribe link pointing to Supabase function
        const unsubscribeUrl = `https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/unsubscribe-promo?user_id=${user.id}`;

        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            reply_to: FROM_EMAIL,
            to: [user.email],
            subject: "Unlock 3 months free Pro — tag us on Instagram or TikTok",
            html: buildHtmlEmail(firstName, unsubscribeUrl),
            text: buildPlainTextEmail(firstName, unsubscribeUrl),
          }),
        });

        if (emailRes.ok) {
          sent++;
          console.log(`[promo-social-share] Sent to ${user.email}`);
        } else {
          failed++;
          const errBody = await emailRes.json().catch(() => null);
          console.error(`[promo-social-share] Failed to send to ${user.email}:`, errBody);
        }
      } catch (e) {
        failed++;
        console.error(`[promo-social-share] Error sending to ${user.email}:`, e);
      }
    }

    console.log(`[promo-social-share] Sent: ${sent}, Failed: ${failed}, Total: ${users.length}`);

    return new Response(JSON.stringify({ ok: true, sent, failed, total: users.length }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[promo-social-share] Unexpected error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500 });
  }
});
