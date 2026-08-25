import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  const url = new URL(req.url);
  const userId = url.searchParams.get("user_id");

  if (!userId) {
    return new Response(
      `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
  <h1>Missing user ID</h1>
  <p>Cannot process unsubscribe without a valid user ID.</p>
</body>
</html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Update profile to mark as unsubscribed from promotions
    const { error } = await supabase
      .from("profiles")
      .update({ email_promotions_unsubscribed: true })
      .eq("user_id", userId);

    if (error) {
      console.error("[unsubscribe-promo] Error updating profile:", error);
      return new Response(
        `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
  <h1>Error</h1>
  <p>We couldn't process your unsubscribe request. Please try again later.</p>
</body>
</html>`,
        { status: 500, headers: { "Content-Type": "text/html" } }
      );
    }

    console.log(`[unsubscribe-promo] User ${userId} unsubscribed from promotions`);

    return new Response(
      `<!DOCTYPE html>
<html>
<head>
  <title>Unsubscribed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
      padding: 40px 20px;
      text-align: center;
      background: #f5f5f5;
    }
    .container {
      max-width: 500px;
      margin: 0 auto;
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
    }
    h1 {
      color: #1a1a2e;
      margin: 0 0 16px;
      font-size: 24px;
    }
    p {
      color: #666;
      margin: 0;
      line-height: 1.6;
    }
    .checkmark {
      font-size: 48px;
      margin-bottom: 20px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="checkmark">✓</div>
    <h1>Unsubscribed</h1>
    <p>You've been removed from our promotional emails. We'll only send you essential updates about your account.</p>
  </div>
</body>
</html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (e) {
    console.error("[unsubscribe-promo] Unexpected error:", e);
    return new Response(
      `<!DOCTYPE html>
<html>
<head><title>Error</title></head>
<body style="font-family: system-ui; padding: 40px; text-align: center;">
  <h1>Error</h1>
  <p>An unexpected error occurred. Please try again later.</p>
</body>
</html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
});
