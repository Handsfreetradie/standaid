import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { getStripe, tierForPriceId, isActiveStatus } from "../_shared/stripe.ts";

// Stripe → app sync. This is the ONLY place profiles.subscription_tier is
// changed for billing. It is called by Stripe (no Supabase JWT), so it must be
// verify_jwt = false and instead verify the Stripe signature. Never trust the
// client for tier.

const cryptoProvider = Stripe.createSubtleCryptoProvider();

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!webhookSecret) {
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set — refusing");
    return new Response("Not configured", { status: 503 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text(); // raw body required for signature verification
  const stripe = getStripe();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret, undefined, cryptoProvider);
  } catch (err) {
    console.error("[stripe-webhook] signature verification failed:", err instanceof Error ? err.message : err);
    return new Response("Invalid signature", { status: 400 });
  }

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve the app user from a Stripe customer id.
  const userIdForCustomer = async (customerId: string): Promise<string | null> => {
    const { data } = await supabaseAdmin
      .from("profiles").select("user_id").eq("stripe_customer_id", customerId).single();
    return data?.user_id ?? null;
  };

  // Apply a subscription's current state to our tables.
  const applySubscription = async (sub: Stripe.Subscription) => {
    const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
    const userId = sub.metadata?.user_id ?? (await userIdForCustomer(customerId));
    if (!userId) {
      console.error("[stripe-webhook] no user for customer", customerId);
      return;
    }

    const priceId = sub.items.data[0]?.price?.id;
    const paidTier = tierForPriceId(priceId);
    const active = isActiveStatus(sub.status);
    // Access tier: the paid tier while active/trialing, otherwise back to free.
    const accessTier = active && paidTier ? paidTier : "free";
    const quantity = sub.items.data[0]?.quantity ?? 1;

    console.log(`[stripe-webhook] Processing: priceId=${priceId}, paidTier=${paidTier}, active=${active}, status=${sub.status}, userId=${userId}`);

    await supabaseAdmin.from("subscriptions").upsert({
      user_id: userId,
      stripe_customer_id: customerId,
      stripe_subscription_id: sub.id,
      status: sub.status,
      tier: paidTier ?? "free",
      quantity,
      current_period_end: sub.current_period_end
        ? new Date(sub.current_period_end * 1000).toISOString() : null,
      cancel_at_period_end: sub.cancel_at_period_end ?? false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "stripe_subscription_id" });

    await supabaseAdmin.from("profiles")
      .update({ subscription_tier: accessTier })
      .eq("user_id", userId);

    // Send confirmation email if upgrading to paid plan
    if (active && paidTier && (sub.status === "active" || sub.status === "trialing")) {
      const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
      const userEmail = data?.user?.email;
      console.log(`[stripe-webhook] Email send attempt: email=${userEmail}`);
      if (userEmail) {
        const displayName = (await supabaseAdmin
          .from("profiles")
          .select("display_name")
          .eq("user_id", userId)
          .single()
          .then(r => r.data?.display_name)) || userEmail.split("@")[0];

        // Send receipt email via Resend
        const resendKey = Deno.env.get("RESEND_API_KEY");
        if (resendKey) {
          const tierName = paidTier === "business" ? "Business" : "Pro";
          const price = paidTier === "business" ? "$49.99" : "$19.99";
          const todayDate = new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });

          const htmlEmail = `<!DOCTYPE html>
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
                    <p style="margin:0 0 12px 0;font-weight:600;color:#1a1a2e;">📋 Receipt Details</p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
                      <tr>
                        <td style="padding:6px 0;color:#888;">Receipt date:</td>
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

              <p style="margin:28px 0 0;padding-top:28px;border-top:1px solid #f0f0f0;font-size:13px;color:#888;line-height:1.6;">
                <strong>Billing:</strong> Your subscription renews automatically each month. You can view, download, or cancel your subscription anytime in your StandAId profile under "Subscription & Billing".
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

          fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: `StandAId <hello@standaid.ai>`,
              to: userEmail,
              subject: `Welcome to ${tierName} Plan — StandAId`,
              html: htmlEmail,
            }),
          }).then(r => r.json()).then(result => {
            console.log(`[stripe-webhook] Sent receipt to ${userEmail}:`, result.id ?? result.error);
          }).catch(e => console.error("[stripe-webhook] email send failed:", e));
        }
      }
    }

    console.log(`[stripe-webhook] ${userId} → ${accessTier} (sub ${sub.status})`);

    // Team subscriptions additionally own an `organizations` row — seat_limit
    // is written ONLY here (mirrors how subscription_tier is webhook-only),
    // so it always reflects what's actually been paid for.
    if (sub.metadata?.is_team === "true") {
      const { data: existingOrg } = await supabaseAdmin
        .from("organizations")
        .select("id")
        .eq("stripe_subscription_id", sub.id)
        .maybeSingle();

      if (existingOrg) {
        await supabaseAdmin
          .from("organizations")
          .update({ seat_limit: quantity })
          .eq("id", existingOrg.id);
        console.log(`[stripe-webhook] org ${existingOrg.id} seat_limit → ${quantity}`);
      } else if (active) {
        // First time seeing this team subscription — create the org and add
        // the owner as its first (active) member.
        const { data: newOrg, error: orgError } = await supabaseAdmin
          .from("organizations")
          .insert({
            name: sub.metadata?.team_name || "My Team",
            owner_user_id: userId,
            stripe_subscription_id: sub.id,
            seat_limit: quantity,
          })
          .select("id")
          .single();

        if (orgError || !newOrg) {
          console.error("[stripe-webhook] failed to create organization:", orgError);
        } else {
          const { data: ownerUser } = await supabaseAdmin.auth.admin.getUserById(userId);
          const ownerEmail = ownerUser?.user?.email;
          if (ownerEmail) {
            await supabaseAdmin.from("organization_members").insert({
              organization_id: newOrg.id,
              invited_email: ownerEmail.toLowerCase(),
              user_id: userId,
              role: "owner",
              status: "active",
              joined_at: new Date().toISOString(),
            });
          }
          console.log(`[stripe-webhook] created org ${newOrg.id} for ${userId}, seat_limit ${quantity}`);
        }
      }
    }
  };

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await applySubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "checkout.session.completed": {
        // Fetch the full subscription the checkout created, then apply it.
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.subscription) {
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
          const sub = await stripe.subscriptions.retrieve(subId);
          await applySubscription(sub);
        }
        break;
      }
      default:
        // Ignore other event types
        break;
    }
  } catch (e) {
    console.error("[stripe-webhook] handler error:", e);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200, headers: { "Content-Type": "application/json" },
  });
});
