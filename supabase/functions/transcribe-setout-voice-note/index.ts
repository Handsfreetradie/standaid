import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAllowedOrigin } from "../_shared/cors.ts";

// Transcribes one setout voice note via Deepgram's pre-recorded API, called
// server-side only — the API key never reaches the client. Modelled on
// analyze-audit-photo/index.ts's shape (auth -> load row -> download from
// storage -> call the external API -> write the result back), but simpler:
// Deepgram's pre-recorded endpoint is synchronous, so one request here is
// the whole job — no polling/webhook needed.
//
// Ownership check: setout_voice_notes has no user_id column of its own
// (RLS scopes it via its parent plan, same as setout_photo_points) — this
// function uses the service-role client, which bypasses RLS, so it has to
// re-check ownership itself by joining to setout_plans.user_id.

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

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return json({ error: "Unauthorized" }, 401);

    const { voice_note_id } = await req.json();
    if (!voice_note_id) return json({ error: "voice_note_id is required" }, 400);

    const DEEPGRAM_API_KEY = Deno.env.get("DEEPGRAM_API_KEY");
    if (!DEEPGRAM_API_KEY) return json({ error: "Service unavailable" }, 500);

    const { data: note } = await supabase
      .from("setout_voice_notes")
      .select("*, setout_plans!inner(user_id)")
      .eq("id", voice_note_id)
      .single();
    if (!note || note.setout_plans?.user_id !== user.id) return json({ error: "Voice note not found" }, 404);

    await supabase.from("setout_voice_notes").update({ status: "transcribing" }).eq("id", voice_note_id);

    const { data: fileData, error: dlError } = await supabase.storage
      .from("setout-voice-notes")
      .download(note.storage_path);
    if (dlError || !fileData) {
      await supabase.from("setout_voice_notes").update({ status: "failed" }).eq("id", voice_note_id);
      return json({ error: "Could not load the recording" }, 500);
    }

    const dgRes = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&language=en-AU",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${DEEPGRAM_API_KEY}`,
          "Content-Type": note.content_type || "audio/webm",
        },
        body: fileData,
      },
    );

    if (!dgRes.ok) {
      const errText = await dgRes.text();
      console.error("[transcribe-setout-voice-note] Deepgram error:", dgRes.status, errText);
      await supabase.from("setout_voice_notes").update({ status: "failed" }).eq("id", voice_note_id);
      return json({ error: "Transcription failed — please try again." }, 502);
    }

    const dgData = await dgRes.json();
    const transcript: string | undefined = dgData?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
    if (!transcript) {
      await supabase.from("setout_voice_notes").update({ status: "failed" }).eq("id", voice_note_id);
      return json({ error: "No speech detected in that recording" }, 502);
    }

    await supabase.from("setout_voice_notes").update({
      status: "done",
      transcript,
      updated_at: new Date().toISOString(),
    }).eq("id", voice_note_id);

    return json({ status: "done", transcript });
  } catch (e) {
    console.error("[transcribe-setout-voice-note] error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
