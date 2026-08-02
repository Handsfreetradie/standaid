import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

// Owner-only tool: gives someone free Pro access for N days (default 14) and
// emails them a branded invite. Reuses the existing pro_expires_at column +
// hourly expire_promo_pro() cron (supabase/migrations/20260721000000_promo_pro_expiry.sql)
// for auto-expiry — deliberately not a real Stripe trial, so no card/billing
// object is ever created for someone who isn't paying.
//
// If the email already has an account, the profile is updated directly. If
// not, the grant is parked in trial_grants and applied by handle_new_user()
// the moment they sign up (supabase/migrations/20260802000000_trial_grants.sql).

const ADMIN_EMAIL = "kyledixonelectrical@gmail.com";

const APP_URL = "https://standaid-9mas.vercel.app";
const LOGO_URL = "https://standaid-9mas.vercel.app/pwa-192.png";
const FROM_EMAIL = "hello@standaid.ai";
const FROM_NAME = "StandAId";

function buildHtmlEmail(days: number, expiresLabel: string, isNewAccount: boolean): string {
  const heading = `You've got ${days} days free on StandAId 🎉`;
  const body = isNewAccount
    ? `You've been given <strong>${days} days of free Pro access</strong> to StandAId — Australian Standards search, exam prep and on-site tools for tradies. Create your account with this email address and Pro access is already waiting for you.`
    : `You've been given <strong>${days} days of free Pro access</strong> to StandAId. Just log back in with this email address — no card required, and it's already switched on.`;
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
            <td style="background:#ffffff;padding:28px 40px;text-align:center;border-bottom:1px solid #f0f0f0;">
              <img src="${LOGO_URL}" alt="StandAId" width="64" height="64" style="display:block;margin:0 auto 14px;border-radius:14px;" />
              <p style="margin:0;font-size:28px;font-weight:800;color:#1a1a2e;letter-spacing:-0.5px;">Stand<span style="color:#eb1414;">Ai</span>d</p>
              <p style="margin:6px 0 0;font-size:12px;color:#888;letter-spacing:0.8px;text-transform:uppercase;">Australian Standards AI Assistant</p>
            </td>
          </tr>
          <tr>
            <td style="padding:40px 40px 32px;">
              <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:#1a1a2e;">${heading}</p>
              <p style="margin:0 0 28px;font-size:15px;color:#555;line-height:1.6;">${body}</p>
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center">
                    <a href="${APP_URL}" style="display:inline-block;background:#eb1414;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 36px;border-radius:8px;letter-spacing:0.2px;">${cta}</a>
                  </td>
                </tr>
              </table>
              <p style="margin:24px 0 0;font-size:12px;color:#999;text-align:center;">Your free access ends ${expiresLabel}.</p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 28px;">
              <p style="margin:0;font-size:12px;color:#777;background:#f8f8fc;border-radius:8px;padding:14px 16px;line-height:1.5;">
                Found something broken? Rate any chat answer 👍/👎 to flag it — every bug report helps make StandAId better.
              </p>
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

function buildPlainTextEmail(days: number, expiresLabel: string, isNewAccount: boolean): string {
  const body = isNewAccount
    ? `You've been given ${days} days of free Pro access to StandAId. Create your account with this email address and Pro access is already waiting for you.`
    : `You've been given ${days} days of free Pro access to StandAId. Just log back in with this email address — no card required.`;
  return `You've got ${days} days free on StandAId\n\n${body}\n\nOpen the app: ${APP_URL}\n\nYour free access ends ${expiresLabel}.\n\nFound something broken? Rate any chat answer 👍/👎 to flag it — every bug report helps make StandAId better.\n\n---\nStandAId · Australian Standards AI Assistant\n`;
}

serve(async (req) => {
  const origin = req.headers.get("Origin") || "";
  const corsHeaders = {
    "Access-Control-Allow-Origin": getAllowedOrigin(origin),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) return json({ error: "Unauthorized" }, 401);
    if (user.email !== ADMIN_EMAIL) return json({ error: "Forbidden" }, 403);

    const { email, days: rawDays } = await req.json();
    const cleanEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
    if (!cleanEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      return json({ error: "Enter a valid email address" }, 400);
    }
    const days = rawDays === undefined ? 14 : Math.round(Number(rawDays));
    if (!Number.isInteger(days) || days < 1 || days > 90) {
      return json({ error: "days must be a whole number between 1 and 90" }, 400);
    }

    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
    const expiresLabel = expiresAt.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

    const { data: existingProfile, error: profileError } = await supabaseAdmin
      .from("profiles")
      .select("user_id")
      .ilike("email", cleanEmail)
      .maybeSingle();
    if (profileError) throw profileError;

    const isNewAccount = !existingProfile;

    if (existingProfile) {
      const { error: updateError } = await supabaseAdmin
        .from("profiles")
        .update({ subscription_tier: "pro", pro_expires_at: expiresAt.toISOString() })
        .eq("user_id", existingProfile.user_id);
      if (updateError) throw updateError;
    } else {
      const { error: grantError } = await supabaseAdmin
        .from("trial_grants")
        .upsert(
          { email: cleanEmail, tier: "pro", days, granted_by: user.id, redeemed_at: null },
          { onConflict: "email" },
        );
      if (grantError) throw grantError;
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    if (!RESEND_API_KEY) {
      console.error("[grant-trial] RESEND_API_KEY not set");
      return json({ error: "Email service not configured" }, 500);
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
        to: [cleanEmail],
        subject: `You've got ${days} days free on StandAId`,
        html: buildHtmlEmail(days, expiresLabel, isNewAccount),
        text: buildPlainTextEmail(days, expiresLabel, isNewAccount),
      }),
    });

    if (!emailRes.ok) {
      const errBody = await emailRes.json().catch(() => null);
      console.error("[grant-trial] Resend error:", JSON.stringify(errBody));
      return json({ error: "Trial granted but the email failed to send", details: errBody }, 500);
    }

    console.log(`[grant-trial] ${cleanEmail} → pro for ${days} days (new account: ${isNewAccount})`);
    return json({ ok: true, isNewAccount, expiresAt: expiresAt.toISOString() });
  } catch (e) {
    console.error("[grant-trial] Unexpected error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
