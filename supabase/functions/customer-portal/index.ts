import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";
import { getStripe } from "../_shared/stripe.ts";

// Returns a Stripe Billing Portal URL so the user can manage or cancel their
// own subscription. Stripe hosts the portal — we never handle card details.

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

    const { data: profile } = await supabaseAdmin
      .from("profiles").select("stripe_customer_id").eq("user_id", user.id).single();
    const customerId = profile?.stripe_customer_id as string | null;
    if (!customerId) return json({ error: "No subscription found" }, 404);

    const stripe = getStripe();
    const appUrl = getAllowedOrigin(origin);
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/profile`,
    });

    return json({ url: portal.url });
  } catch (e) {
    console.error("[customer-portal] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
