import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { getStripe, priceIdForTier, teamSeatPriceId } from "../_shared/stripe.ts";

// Creates a Stripe Checkout Session for a subscription and returns its URL.
// The browser redirects the user to that URL to enter payment.

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

    const { tier, initial_seats, team_name } = await req.json();
    if (tier !== "pro" && tier !== "business" && tier !== "business_team") {
      return json({ error: "Invalid tier" }, 400);
    }

    let seats = 1;
    if (tier === "business_team") {
      seats = Number(initial_seats);
      if (!Number.isInteger(seats) || seats < 1 || seats > 500) {
        return json({ error: "initial_seats must be a whole number between 1 and 500" }, 400);
      }
      if (!team_name || typeof team_name !== "string" || !team_name.trim()) {
        return json({ error: "team_name is required" }, 400);
      }
    }

    const stripe = getStripe();

    // Reuse the customer if we have one, otherwise create it and save the id.
    const { data: profile } = await supabaseAdmin
      .from("profiles").select("stripe_customer_id").eq("user_id", user.id).single();

    let customerId = profile?.stripe_customer_id as string | null;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { user_id: user.id },
      });
      customerId = customer.id;
      await supabaseAdmin.from("profiles").update({ stripe_customer_id: customerId }).eq("user_id", user.id);
    }

    const appUrl = getAllowedOrigin(origin);
    const isTeam = tier === "business_team";
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: isTeam ? teamSeatPriceId() : priceIdForTier(tier), quantity: seats }],
      allow_promotion_codes: true,
      subscription_data: {
        metadata: isTeam
          ? { user_id: user.id, is_team: "true", team_name: team_name.trim() }
          : { user_id: user.id },
      },
      success_url: `${appUrl}/${isTeam ? "team" : "profile"}?checkout=success`,
      cancel_url: `${appUrl}/${isTeam ? "team" : "profile"}?checkout=cancelled`,
    });

    return json({ url: session.url });
  } catch (e) {
    console.error("[create-checkout] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
