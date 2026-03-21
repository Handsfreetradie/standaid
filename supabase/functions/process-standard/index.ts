import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 2000;
const OVERLAP = 200;

// ── PDF text extraction (regex-based, no AI) ──

function extractTextBasic(fileBytes: Uint8Array): string {
  const decoder = new TextDecoder("latin1");
  const rawText = decoder.decode(fileBytes);

  const allText: string[] = [];

  // Extract parenthesised text strings
  const textRegex = /\(([^)]*)\)/g;
  let match;
  while ((match = textRegex.exec(rawText)) !== null) {
    const text = match[1]
      .replace(/\\n/g, "\n").replace(/\\r/g, "\r").replace(/\\t/g, "\t")
      .replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
    if (text.trim().length > 0 && !/^[<>{}[\]]+$/.test(text)) allText.push(text);
  }

  // Extract TJ array text
  const tjRegex = /\[([^\]]*)\]\s*TJ/g;
  while ((match = tjRegex.exec(rawText)) !== null) {
    const innerTextRegex = /\(([^)]*)\)/g;
    let innerMatch;
    while ((innerMatch = innerTextRegex.exec(match[1])) !== null) {
      if (innerMatch[1].trim().length > 0) allText.push(innerMatch[1]);
    }
  }

  return allText.join(" ").replace(/\s+/g, " ").trim();
}

function cleanExtractedText(text: string): string {
  return text
    .replace(/\b(BT|ET|Tj|TJ|Tf|Td|Tm|cm|re|f|W|n|q|Q|rg|RG|gs|Do|CS|cs|SC|sc)\b/g, " ")
    .replace(/\b\d+\.\d+\s+\d+\.\d+\s+\d+\.\d+\s+(rg|RG)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// AI-OCR fallback for scanned/image PDFs (< 3MB only)
async function extractTextWithAI(fileBytes: Uint8Array, apiKey: string): Promise<string> {
  if (fileBytes.length > 3 * 1024 * 1024) throw new Error("PDF too large for AI extraction");

  const binaryStr = Array.from(fileBytes).map(b => String.fromCharCode(b)).join("");
  const base64 = btoa(binaryStr);

  const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "system", content: "Extract ALL text from this PDF verbatim. Preserve headings, clause numbers, paragraph breaks. Do NOT summarize." },
        { role: "user", content: [
          { type: "text", text: "Extract ALL text from this PDF document verbatim." },
          { type: "image_url", image_url: { url: `data:application/pdf;base64,${base64}` } },
        ]},
      ],
      max_tokens: 16000,
    }),
  });

  if (!response.ok) throw new Error(`AI extraction failed: ${response.status}`);
  const data = await response.json();
  const text = data.choices?.[0]?.message?.content;
  if (!text || text.length < 50) throw new Error("AI extraction returned insufficient text");
  return text;
}

function extractText(fileBytes: Uint8Array, apiKey: string): Promise<string> {
  return (async () => {
    const basic = extractTextBasic(fileBytes);
    if (basic.length > 200) {
      const cleaned = cleanExtractedText(basic);
      const alphaCount = (cleaned.match(/[a-zA-Z0-9]/g) || []).length;
      if (cleaned.length > 200 && alphaCount / cleaned.length > 0.3) {
        console.log(`Regex extraction OK: ${cleaned.length} chars`);
        return cleaned;
      }
    }
    console.log("Falling back to AI-OCR extraction…");
    try {
      return await extractTextWithAI(fileBytes, apiKey);
    } catch {
      if (basic.length > 50) return cleanExtractedText(basic);
      throw new Error("Could not extract text from this PDF.");
    }
  })();
}

// ── Chunking with overlap ──

function chunkText(text: string): { text: string; chunk_index: number }[] {
  const chunks: { text: string; chunk_index: number }[] = [];
  let start = 0;
  let idx = 0;

  while (start < text.length) {
    let end = Math.min(start + CHUNK_SIZE, text.length);

    // Try to break at a sentence or paragraph boundary
    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastBreak = Math.max(
        slice.lastIndexOf("\n\n"),
        slice.lastIndexOf(". "),
        slice.lastIndexOf(".\n"),
      );
      if (lastBreak > CHUNK_SIZE * 0.5) {
        end = start + lastBreak + 1;
      }
    }

    const chunkText = text.slice(start, end).trim();
    if (chunkText.length > 20) {
      chunks.push({ text: chunkText, chunk_index: idx++ });
    }

    // Advance with overlap
    start = end - OVERLAP;
    if (start >= text.length) break;
    // Prevent infinite loop if overlap pushes us back too far
    if (end >= text.length) break;
  }

  return chunks;
}

// ── Main handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;
    const { standard_id, user_id: internalUserId } = await req.json();

    if (!standard_id) {
      return new Response(JSON.stringify({ error: "standard_id is required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let userId: string | null = null;

    // Internal trusted call from backend functions
    if (token && token === serviceRoleKey && internalUserId) {
      userId = internalUserId;
    } else {
      if (!token) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }

      const supabaseUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
        global: { headers: { Authorization: `Bearer ${token}` } },
      });

      const { data: claimsData, error: claimsError } = await supabaseUser.auth.getClaims(token);
      if (claimsError || !claimsData?.claims) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
      }
      userId = claimsData.claims.sub as string;
    }

    // Fetch standard record
    const { data: standard, error: stdErr } = await supabaseAdmin
      .from("standards").select("*").eq("id", standard_id).eq("user_id", userId).single();
    if (stdErr || !standard) {
      return new Response(JSON.stringify({ error: "Standard not found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    await supabaseAdmin.from("standards").update({ extraction_status: "processing" }).eq("id", standard_id);

    // Download PDF from storage
    const { data: fileData, error: dlErr } = await supabaseAdmin.storage.from("standards").download(standard.file_path!);
    if (dlErr || !fileData) {
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Failed to download file" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
    const fileBytes = new Uint8Array(await fileData.arrayBuffer());

    // Step 1: Extract raw text
    let rawText: string;
    try {
      rawText = await extractText(fileBytes, LOVABLE_API_KEY);
    } catch (e) {
      console.error("Extraction failed:", e);
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Could not extract text from this PDF." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 2: Chunk with ~2000 char size and 200 char overlap
    const chunks = chunkText(rawText);
    const totalChunks = chunks.length;

    if (totalChunks === 0) {
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "No meaningful text found in document." }), { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Step 3: Store each chunk with processed = false (is_indexed = false, no embedding)
    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const records = batch.map(c => ({
        standard_id,
        user_id: userId,
        content: c.text,
        chunk_index: c.chunk_index,
        is_indexed: false,
        embedding: null,
        clause_number: null,
        clause_title: null,
        page_number: null,
      }));

      const { error: insertErr } = await supabaseAdmin.from("standard_chunks").insert(records);
      if (insertErr) console.error("Chunk insert error:", insertErr);
    }

    // Update standard as complete
    const qualityScore = rawText.length > 500 ? 85 : rawText.length > 100 ? 50 : 10;
    await supabaseAdmin.from("standards").update({
      extraction_status: "complete",
      extraction_quality_score: qualityScore,
      total_chunks: totalChunks,
      indexed_chunks: 0,
    }).eq("id", standard_id);

    // Return chunk array for inspection
    return new Response(JSON.stringify({
      status: "complete",
      total_chunks: totalChunks,
      raw_text_length: rawText.length,
      quality_score: qualityScore,
      chunks: chunks.map(c => ({
        chunk_id: c.chunk_index,
        text: c.text.slice(0, 500) + (c.text.length > 500 ? "…" : ""),
        char_count: c.text.length,
        processed: false,
      })),
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("Processing error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
