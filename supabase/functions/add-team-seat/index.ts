import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { getStripe } from "../_shared/stripe.ts";

// Buys one more seat on a team's Stripe subscription (prorated, charged
// immediately) and raises organizations.seat_limit to match — called before
// add_org_member() when a team is already at capacity. Owner-only.

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

    const { organization_id } = await req.json();
    if (!organization_id) return json({ error: "organization_id is required" }, 400);

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("id, owner_user_id, stripe_subscription_id, seat_limit")
      .eq("id", organization_id)
      .single();

    if (orgError || !org) return json({ error: "Team not found" }, 404);
    if (org.owner_user_id !== user.id) return json({ error: "Only the team owner can add seats" }, 403);
    if (!org.stripe_subscription_id) return json({ error: "This team has no active subscription" }, 400);

    const stripe = getStripe();
    const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
    const item = subscription.items.data[0];
    if (!item) return json({ error: "Subscription has no billable item" }, 500);

    const newQuantity = (item.quantity ?? org.seat_limit) + 1;

    await stripe.subscriptionItems.update(item.id, {
      quantity: newQuantity,
      proration_behavior: "create_prorations",
    });

    // Optimistic bump — the Stripe call succeeding is authoritative, so the
    // owner doesn't have to wait on the webhook round-trip before adding the
    // member. The webhook's subscription.updated event reconciles the same
    // value shortly after.
    await supabaseAdmin
      .from("organizations")
      .update({ seat_limit: newQuantity })
      .eq("id", org.id);

    await supabaseAdmin
      .from("subscriptions")
      .update({ quantity: newQuantity })
      .eq("stripe_subscription_id", org.stripe_subscription_id);

    console.log(`[add-team-seat] org ${org.id} seat_limit → ${newQuantity}`);
    return json({ seat_limit: newQuantity });
  } catch (e) {
    console.error("[add-team-seat] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
