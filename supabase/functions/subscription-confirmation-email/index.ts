import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Sends a subscription confirmation email via Resend
// Called when a user upgrades to a paid plan

const APP_URL = "https://app.standaid.ai";
const LOGO_URL = "https://app.standaid.ai/pwa-192.png";
const FROM_EMAIL = "hello@standaid.ai";
const FROM_NAME = "StandAId";

function buildHtmlEmail(displayName: string, tier: string, amount: string = "", invoiceDate: string = ""): string {
  const tierName = tier === "business" ? "Business" : "Pro";
  const price = tier === "business" ? "$49.99" : "$19.99";
  const todayDate = invoiceDate || new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Welcome to ${tierName} Plan</title>
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
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">Welcome to ${tierName}, ${displayName}! 🎉</p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">
                Thank you for upgrading to StandAId ${tierName}. Your subscription is now active and you'll have unlimited access to all Premium features.
              </p>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;border-radius:8px;padding:20px;margin:0 0 28px;border:1px solid #e0e0e0;">
                <tr>
                  <td style="font-size:13px;color:#555;">
                    <p style="margin:0 0 12px 0;font-weight:600;color:#1a1a2e;">📋 Invoice Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
                      <tr>
                        <td style="padding:6px 0;color:#888;">Invoice date:</td>
                        <td style="padding:6px 0;text-align:right;color:#1a1a2e;font-weight:600;">${todayDate}</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#888;">Plan:</td>
                        <td style="padding:6px 0;text-align:right;color:#1a1a2e;font-weight:600;">${tierName} Plan</td>
                      </tr>
                      <tr>
                        <td style="padding:6px 0;color:#888;">Amount:</td>
                        <td style="padding:6px 0;text-align:right;color:#1a1a2e;font-weight:600;">${price} AUD/month</td>
                      </tr>
                      <tr style="border-top:1px solid #ddd;">
                        <td style="padding:10px 0;color:#1a1a2e;font-weight:700;font-size:14px;">Total:</td>
                        <td style="padding:10px 0;text-align:right;color:#eb1414;font-weight:700;font-size:14px;">${price} AUD</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f9f9;border-radius:8px;padding:20px;margin:0 0 28px;border:1px solid #e0e0e0;">
                <tr>
                  <td style="font-size:13px;color:#555;">
                    <p style="margin:0 0 12px 0;font-weight:600;color:#1a1a2e;">ℹ️ StandAId Details</p>
                    <p style="margin:0 0 6px;font-size:13px;color:#555;">
                      <strong>StandAId Pty Ltd</strong><br/>
                      Australian Standards AI Assistant<br/>
                      Perth, Western Australia<br/>
                      hello@standaid.ai
                    </p>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f5;border-radius:8px;padding:20px;margin:0 0 28px;border:1px solid #e0e0e0;">
                <tr>
                  <td style="font-size:13px;color:#555;">
                    <p style="margin:0 0 12px 0;font-weight:600;color:#1a1a2e;">What you can do now:</p>
                    <ul style="margin:0;padding-left:20px;color:#555;">
                      <li style="margin:0 0 6px;">Upload unlimited Australian Standards</li>
                      <li style="margin:0 0 6px;">Search unlimited times (${tierName === "Pro" ? "up to 30/minute" : "unlimited"})</li>
                      <li style="margin:0 0 6px;">Access full clause references</li>
                      <li style="margin:0 0 6px;">Use voice input for queries</li>
                      ${tierName === "Business" ? "<li style=\"margin:0 0 6px;\">Invite team members to shared libraries</li>" : ""}
                    </ul>
                  </td>
                </tr>
              </table>

              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${APP_URL}" style="display:inline-block;background:#eb1414;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">Open StandAId →</a>
                  </td>
                </tr>
              </table>

              <p style="margin:28px 0 0;padding-top:28px;border-top:1px solid #f0f0f0;font-size:13px;color:#888;line-height:1.6;">
                <strong>Billing:</strong> You'll receive an invoice at the email address on file each month. You can view, download, or cancel your subscription anytime in your StandAId profile under "Subscription & Billing".
              </p>
              <p style="margin:16px 0 0;font-size:13px;color:#888;line-height:1.6;">
                <strong>Questions?</strong> Reply to this email or contact us at hello@standaid.ai — we're here to help!
              </p>
            </td>
          </tr>
          <tr>
            <td style="background:#f9f9f9;padding:20px 40px;text-align:center;border-top:1px solid #f0f0f0;">
              <p style="margin:0;font-size:12px;color:#999;">© 2026 StandAId. All rights reserved.</p>
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

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    return new Response(JSON.stringify({ error: "RESEND_API_KEY not configured" }), { status: 503, headers: { "Content-Type": "application/json" } });
  }

  try {
    const { email, displayName, tier } = await req.json();
    if (!email || !displayName || !tier) {
      return new Response(JSON.stringify({ error: "email, displayName, and tier required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    if (tier !== "pro" && tier !== "business") {
      return new Response(JSON.stringify({ error: "tier must be 'pro' or 'business'" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const html = buildHtmlEmail(displayName, tier);

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: `${FROM_NAME} <${FROM_EMAIL}>`,
        to: email,
        subject: `Welcome to ${tier === "business" ? "Business" : "Pro"} Plan — StandAId`,
        html,
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.json().catch(() => null);
      throw new Error(`Resend error: ${emailRes.status} ${JSON.stringify(errBody)}`);
    }

    const result = await emailRes.json();
    console.log(`[subscription-confirmation-email] Sent to ${email}:`, result.id);

    return new Response(JSON.stringify({ success: true, messageId: result.id }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[subscription-confirmation-email] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
