import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { tierForPriceId, isActiveStatus } from "../_shared/stripe.ts";

// Manual sync endpoint: checks Stripe subscription and updates profile if needed.
// Usage: POST with { email: "user@email.com" }

serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  const supabaseAdmin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    adminKey!,
  );

  try {
    const { email } = await req.json();
    if (!email) return new Response(JSON.stringify({ error: "email required" }), { status: 400, headers: { "Content-Type": "application/json" } });

    // Find user by email
    const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError || !users) {
      return new Response(JSON.stringify({ error: "Failed to list users" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }

    const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (!user) {
      return new Response(JSON.stringify({ error: `User not found: ${email}` }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    // Get profile
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("stripe_customer_id, subscription_tier")
      .eq("user_id", user.id)
      .single();

    if (!profile?.stripe_customer_id) {
      return new Response(JSON.stringify({ error: "User has no Stripe customer ID" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    // Check Stripe subscription
    const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
      apiVersion: "2024-06-20",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const subscriptions = await stripe.subscriptions.list({
      customer: profile.stripe_customer_id,
      limit: 1,
    });

    if (!subscriptions.data.length) {
      return new Response(JSON.stringify({ error: "No subscriptions found in Stripe" }), { status: 404, headers: { "Content-Type": "application/json" } });
    }

    const sub = subscriptions.data[0];
    const priceId = sub.items.data[0]?.price?.id;
    const paidTier = tierForPriceId(priceId);
    const active = isActiveStatus(sub.status);
    const accessTier = active && paidTier ? paidTier : "free";

    // Update profile if needed
    if (profile.subscription_tier !== accessTier) {
      await supabaseAdmin.from("profiles")
        .update({ subscription_tier: accessTier })
        .eq("user_id", user.id);

      console.log(`[sync-subscription] Fixed ${user.email}: ${profile.subscription_tier} → ${accessTier}`);

      return new Response(JSON.stringify({
        success: true,
        user_id: user.id,
        email: user.email,
        old_tier: profile.subscription_tier,
        new_tier: accessTier,
        stripe_status: sub.status,
        paid_tier: paidTier,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({
      success: true,
      message: "Profile already synced",
      user_id: user.id,
      email: user.email,
      tier: accessTier,
      stripe_status: sub.status,
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[sync-subscription] error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
});
