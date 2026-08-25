import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// One-off admin-triggered campaign: nudges signed-up users who have never
// uploaded a standard to try StandAId, pointing them at the free-to-download
// National Construction Code (published by the ABCB, no purchase or licence
// needed — unlike AS/NZS Standards, which are paid/per-purchaser and can't be
// redistributed). See x-webhook-secret gate below — same pattern as
// backfill-welcome-emails, required so a stranger can't trigger a mass send.

const APP_URL = "https://app.standaid.ai";
const LOGO_URL = "https://app.standaid.ai/pwa-192.png";
const FROM_EMAIL = "hello@standaid.ai";
const FROM_NAME = "StandAId";
const NCC_URL = "https://ncc.abcb.gov.au/ncc-2025";

function buildHtmlEmail(firstName: string, unsubscribeUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Get your first Australian Standard loaded in under 2 minutes</title>
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
                Noticed you haven't loaded a standard into StandAId yet — here's a fast way to try it out.
              </p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
                The <strong>National Construction Code (NCC)</strong> is free to download straight from the
                Australian Building Codes Board — no purchase needed. Grab the volume for your trade, upload
                it to StandAId, and start asking it questions on the job instead of digging through the PDF
                yourself.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="padding-bottom:12px;">
                    <a href="${NCC_URL}" style="display:inline-block;background:#eb1414;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">Download the NCC free →</a>
                  </td>
                </tr>
                <tr>
                  <td align="center">
                    <a href="${APP_URL}/standards" style="display:inline-block;background:#1a1a2e;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">Then upload it here →</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:13px;color:#999;text-align:center;">Takes about 2 minutes end to end.</p>
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

Noticed you haven't loaded a standard into StandAId yet — here's a fast way to try it out.

The National Construction Code (NCC) is free to download straight from the Australian Building Codes Board — no purchase needed. Grab the volume for your trade, upload it to StandAId, and start asking it questions on the job instead of digging through the PDF yourself.

Download the NCC free: ${NCC_URL}
Then upload it here: ${APP_URL}/standards

Takes about 2 minutes end to end.

---
StandAId · Australian Standards AI Assistant

Unsubscribe: ${unsubscribeUrl}
`;
}

serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  // Require admin secret — ensures only an admin can trigger this
  // (this function has no verify_jwt gate, same as the other promo/backfill
  // functions, so this header is the only thing stopping a mass send by
  // anyone who finds the URL). Dedicated secret, separate from
  // WELCOME_EMAIL_WEBHOOK_SECRET, which is wired into the live trial-reminder
  // cron — keeping this one independent means rotating it never risks that.
  const adminSecret = Deno.env.get("PROMO_EMAIL_ADMIN_SECRET");
  const incomingSecret = req.headers.get("x-webhook-secret");
  if (!adminSecret || incomingSecret !== adminSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[promo-free-standard] RESEND_API_KEY not set");
      return new Response(JSON.stringify({ error: "Email service not configured" }), { status: 500 });
    }

    // Optional: ?dry_run=true just returns the recipient count/list without sending.
    const url = new URL(req.url);
    const dryRun = url.searchParams.get("dry_run") === "true";

    const { data: { users }, error: usersError } = await supabaseAdmin.auth.admin.listUsers();
    if (usersError || !users) {
      console.error("[promo-free-standard] Could not fetch users:", usersError?.message);
      return new Response(JSON.stringify({ error: "Failed to fetch users" }), { status: 500 });
    }

    // Users who have already uploaded at least one standard — skip them.
    const { data: uploaderRows, error: uploaderError } = await supabaseAdmin
      .from("standards").select("user_id");
    if (uploaderError) {
      console.error("[promo-free-standard] Could not fetch uploaders:", uploaderError.message);
      return new Response(JSON.stringify({ error: "Failed to fetch uploaders" }), { status: 500 });
    }
    const uploaderIds = new Set((uploaderRows ?? []).map((r) => r.user_id as string));

    const targets = users.filter((u) => u.email && !uploaderIds.has(u.id));

    let sent = 0;
    let skippedUnsubscribed = 0;
    let failed = 0;
    const recipients: string[] = [];

    for (const user of targets) {
      try {
        const { data: profileRow } = await supabaseAdmin
          .from("profiles").select("display_name, email_promotions_unsubscribed").eq("user_id", user.id).maybeSingle();

        if (profileRow?.email_promotions_unsubscribed) {
          skippedUnsubscribed++;
          continue;
        }

        const firstName = (profileRow?.display_name || user.email!.split("@")[0]).split(" ")[0];
        const unsubscribeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/unsubscribe-promo?user_id=${user.id}`;

        if (dryRun) {
          recipients.push(user.email!);
          continue;
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
            to: [user.email],
            subject: "Get your first Australian Standard loaded in under 2 minutes",
            html: buildHtmlEmail(firstName, unsubscribeUrl),
            text: buildPlainTextEmail(firstName, unsubscribeUrl),
          }),
        });

        if (emailRes.ok) {
          sent++;
          console.log(`[promo-free-standard] Sent to ${user.email}`);
        } else {
          failed++;
          const errBody = await emailRes.json().catch(() => null);
          console.error(`[promo-free-standard] Failed to send to ${user.email}:`, errBody);
        }
      } catch (e) {
        failed++;
        console.error(`[promo-free-standard] Error sending to ${user.email}:`, e);
      }
    }

    console.log(`[promo-free-standard] Sent: ${sent}, Failed: ${failed}, SkippedUnsubscribed: ${skippedUnsubscribed}, Targets: ${targets.length}`);

    return new Response(JSON.stringify({
      ok: true,
      dry_run: dryRun,
      sent,
      failed,
      skipped_unsubscribed: skippedUnsubscribed,
      targets: targets.length,
      total_users: users.length,
      ...(dryRun ? { recipients } : {}),
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  } catch (e) {
    console.error("[promo-free-standard] Unexpected error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500 });
  }
});
