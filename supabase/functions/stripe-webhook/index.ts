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
      const { data: user } = await supabaseAdmin.auth.admin.getUserById(userId);
      if (user?.email) {
        const displayName = (await supabaseAdmin
          .from("profiles")
          .select("display_name")
          .eq("user_id", userId)
          .single()
          .then(r => r.data?.display_name)) || user.email.split("@")[0];

        // Send confirmation email asynchronously
        const supabaseUrl = Deno.env.get("SUPABASE_URL");
        const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
        if (supabaseUrl && serviceRoleKey) {
          fetch(`${supabaseUrl}/functions/v1/subscription-confirmation-email`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${serviceRoleKey}`,
            },
            body: JSON.stringify({ email: user.email, displayName, tier: paidTier }),
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
