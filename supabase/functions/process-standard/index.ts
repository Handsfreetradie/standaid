import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const CHUNK_SIZE = 2000;
const OVERLAP = 200;

type ParsedChunk = {
  text: string;
  chunk_index: number;
  clause_number: string | null;
  clause_title: string | null;
  page_number: number | null;
};

type LogicalBlock = {
  kind: "section" | "clause" | "table" | "text";
  section: string | null;
  clause_number: string | null;
  clause_title: string | null;
  lines: string[];
  references: Set<string>;
};

function latin1ToBytes(input: string): Uint8Array {
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i++) bytes[i] = input.charCodeAt(i) & 0xff;
  return bytes;
}

function bytesToLatin1(input: Uint8Array): string {
  return new TextDecoder("latin1").decode(input);
}

async function tryInflateStreamBytes(input: Uint8Array): Promise<string | null> {
  for (const format of ["deflate", "deflate-raw"] as const) {
    try {
      const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream(format));
      const inflated = new Uint8Array(await new Response(stream).arrayBuffer());
      return bytesToLatin1(inflated);
    } catch {
      // Try next format
    }
  }
  return null;
}

function decodePdfLiteralString(encoded: string): string {
  return encoded
    .replace(/\\([0-7]{1,3})/g, (_m, octal) => String.fromCharCode(parseInt(octal, 8)))
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\b/g, "\b")
    .replace(/\\f/g, "\f")
    .replace(/\\\(/g, "(")
    .replace(/\\\)/g, ")")
    .replace(/\\\\/g, "\\");
}

function decodePdfHexString(encoded: string): string {
  const cleaned = encoded.replace(/\s+/g, "");
  if (!cleaned) return "";
  const padded = cleaned.length % 2 === 0 ? cleaned : `${cleaned}0`;

  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    bytes[i / 2] = parseInt(padded.slice(i, i + 2), 16);
  }

  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    try {
      return new TextDecoder("utf-16be").decode(bytes.slice(2));
    } catch {
      return "";
    }
  }

  return new TextDecoder("latin1").decode(bytes);
}

function isReadableText(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 3) return false;
  const alphaNumCount = (trimmed.match(/[A-Za-z0-9]/g) || []).length;
  const ratio = alphaNumCount / Math.max(trimmed.length, 1);
  return ratio >= 0.4;
}

function extractLooseReadableStrings(content: string): string[] {
  const lines: string[] = [];

  const literalRegex = /\(((?:\\.|[^\\)]){2,})\)/g;
  let litMatch: RegExpExecArray | null;
  while ((litMatch = literalRegex.exec(content)) !== null) {
    const text = decodePdfLiteralString(litMatch[1]).replace(/\s+/g, " ").trim();
    if (isReadableText(text)) lines.push(text);
  }

  const hexRegex = /<([0-9A-Fa-f\s]{8,})>/g;
  let hexMatch: RegExpExecArray | null;
  while ((hexMatch = hexRegex.exec(content)) !== null) {
    const text = decodePdfHexString(hexMatch[1]).replace(/\s+/g, " ").trim();
    if (isReadableText(text)) lines.push(text);
  }

  return lines;
}

function extractTextLinesFromContent(content: string): string[] {
  const lines: string[] = [];
  const btRegex = /BT([\s\S]*?)ET/g;
  let btMatch: RegExpExecArray | null;

  while ((btMatch = btRegex.exec(content)) !== null) {
    const block = btMatch[1];
    const fragments: string[] = [];

    const tjRegex = /\(((?:\\.|[^\\)])*)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      const txt = decodePdfLiteralString(tjMatch[1]).trim();
      if (txt) fragments.push(txt);
    }

    const quoteRegex = /\(((?:\\.|[^\\)])*)\)\s*["']/g;
    let quoteMatch: RegExpExecArray | null;
    while ((quoteMatch = quoteRegex.exec(block)) !== null) {
      const txt = decodePdfLiteralString(quoteMatch[1]).trim();
      if (txt) fragments.push(txt);
    }

    const tjArrayRegex = /\[([\s\S]*?)\]\s*TJ/g;
    let arrMatch: RegExpExecArray | null;
    while ((arrMatch = tjArrayRegex.exec(block)) !== null) {
      const arr = arrMatch[1];
      const innerStringRegex = /\(((?:\\.|[^\\)])*)\)/g;
      let innerMatch: RegExpExecArray | null;
      while ((innerMatch = innerStringRegex.exec(arr)) !== null) {
        const txt = decodePdfLiteralString(innerMatch[1]).trim();
        if (txt) fragments.push(txt);
      }
    }

    const hexRegex = /<([0-9A-Fa-f\s]+)>\s*Tj/g;
    let hexMatch: RegExpExecArray | null;
    while ((hexMatch = hexRegex.exec(block)) !== null) {
      const txt = decodePdfHexString(hexMatch[1]).trim();
      if (txt) fragments.push(txt);
    }

    if (fragments.length > 0) {
      lines.push(fragments.join(" "));
    }
  }

  return lines;
}

function normalizeExtractedLines(lines: string[]): string[] {
  const cleaned: string[] = [];

  for (const line of lines) {
    const normalized = line
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    if (!normalized) continue;
    if (/^(BT|ET|Tj|TJ|Tf|Td|Tm|cm|re|f|W|n|q|Q|rg|RG|gs|Do|CS|cs|SC|sc)$/i.test(normalized)) continue;

    const alphaNumCount = (normalized.match(/[A-Za-z0-9]/g) || []).length;
    const ratio = alphaNumCount / Math.max(normalized.length, 1);

    if (normalized.length > 20 && ratio < 0.25) continue;
    cleaned.push(normalized);
  }

  return cleaned;
}

async function extractText(fileBytes: Uint8Array): Promise<string> {
  const raw = bytesToLatin1(fileBytes);
  const streamRegex = /stream[\r\n]+([\s\S]*?)endstream/g;
  const collectedLines: string[] = [];
  const seenLines = new Set<string>();

  let streamMatch: RegExpExecArray | null;
  while ((streamMatch = streamRegex.exec(raw)) !== null) {
    const streamBody = streamMatch[1] || "";
    const dictStart = Math.max(0, streamMatch.index - 500);
    const dictionarySnippet = raw.slice(dictStart, streamMatch.index);
    const isFlate = /\/Filter\s*(?:\[[^\]]*\/FlateDecode[^\]]*\]|\/FlateDecode)/s.test(dictionarySnippet);

    const streamBytes = latin1ToBytes(streamBody);
    const decoded = isFlate ? await tryInflateStreamBytes(streamBytes) : streamBody;
    if (!decoded) continue;

    const lines = [...extractTextLinesFromContent(decoded), ...extractLooseReadableStrings(decoded)];
    for (const line of lines) {
      if (!seenLines.has(line)) {
        seenLines.add(line);
        collectedLines.push(line);
      }
    }
  }

  if (collectedLines.length === 0) {
    const fallbackLines = [...extractTextLinesFromContent(raw), ...extractLooseReadableStrings(raw)];
    for (const line of fallbackLines) {
      if (!seenLines.has(line)) {
        seenLines.add(line);
        collectedLines.push(line);
      }
    }
  }

  const normalizedLines = normalizeExtractedLines(collectedLines);
  if (!normalizedLines.length) {
    throw new Error("Could not extract readable text from this PDF.");
  }

  return normalizedLines.join("\n");
}

function parseSectionHeading(line: string): { section: string; title: string | null } | null {
  const explicit = line.match(/^section\s+(\d{1,2})\s*[:\-.]?\s*(.*)$/i);
  if (explicit) return { section: explicit[1], title: explicit[2]?.trim() || null };

  const numeric = line.match(/^(\d{1,2})\s+(?!\d+\.)([A-Z][\w\s\-/,()]{3,})$/);
  if (numeric) return { section: numeric[1], title: numeric[2]?.trim() || null };

  return null;
}

function parseClauseHeading(line: string): { clause: string; title: string | null } | null {
  const explicit = line.match(/^clause\s+(\d+(?:\.\d+)*)\s*[:\-.]?\s*(.*)$/i);
  if (explicit) return { clause: explicit[1], title: explicit[2]?.trim() || null };

  const numbered = line.match(/^(\d+(?:\.\d+){1,6})\s+(.+)$/);
  if (numbered) return { clause: numbered[1], title: numbered[2]?.trim() || null };

  return null;
}

function parseTableHeading(line: string): { tableNumber: string | null; title: string | null } | null {
  const match = line.match(/^table\s+([A-Za-z]?\d+(?:\.\d+)*)\s*[:\-.]?\s*(.*)$/i);
  if (!match) return null;
  return { tableNumber: match[1] || null, title: match[2]?.trim() || null };
}

function extractStandardReferences(text: string): string[] {
  const refs = text.match(/\b(?:AS\/NZS|AS|NZS|IEC|ISO)\s*\d{2,5}(?:\.\d+)?(?::\d{4})?\b/gi) || [];
  return [...new Set(refs.map((r) => r.replace(/\s+/g, " ").trim().toUpperCase()))];
}

function buildLogicalBlocks(rawText: string): LogicalBlock[] {
  const lines = rawText
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  const blocks: LogicalBlock[] = [];
  let currentSection: string | null = null;
  let active: LogicalBlock | null = null;

  const flush = () => {
    if (!active) return;
    const content = active.lines.join(" ").trim();
    if (content.length > 20) blocks.push(active);
    active = null;
  };

  const startBlock = (kind: LogicalBlock["kind"], clauseNumber: string | null, clauseTitle: string | null) => {
    active = {
      kind,
      section: currentSection,
      clause_number: clauseNumber,
      clause_title: clauseTitle,
      lines: [],
      references: new Set<string>(),
    };
  };

  for (const line of lines) {
    const section = parseSectionHeading(line);
    const table = parseTableHeading(line);
    const clause = parseClauseHeading(line);

    if (section) {
      flush();
      currentSection = section.section;
      startBlock("section", `Section ${section.section}`, section.title || null);
      active!.lines.push(line);
      for (const ref of extractStandardReferences(line)) active!.references.add(ref);
      continue;
    }

    if (table) {
      flush();
      startBlock("table", table.tableNumber, table.title ? `Table ${table.tableNumber || ""} ${table.title}`.trim() : `Table ${table.tableNumber || ""}`.trim());
      active!.lines.push(line);
      for (const ref of extractStandardReferences(line)) active!.references.add(ref);
      continue;
    }

    if (clause) {
      flush();
      startBlock("clause", clause.clause, clause.title);
      active!.lines.push(line);
      for (const ref of extractStandardReferences(line)) active!.references.add(ref);
      continue;
    }

    if (!active) startBlock("text", null, null);

    active!.lines.push(line);
    for (const ref of extractStandardReferences(line)) active!.references.add(ref);
  }

  flush();
  return blocks;
}

function splitWithOverlap(text: string, chunkSize: number, overlap: number): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    if (end < text.length) {
      const slice = text.slice(start, end);
      const lastBreak = Math.max(slice.lastIndexOf("\n\n"), slice.lastIndexOf(". "), slice.lastIndexOf("; "));
      if (lastBreak > chunkSize * 0.45) {
        end = start + lastBreak + 1;
      }
    }

    const piece = text.slice(start, end).trim();
    if (piece.length > 20) chunks.push(piece);

    if (end >= text.length) break;
    start = Math.max(end - overlap, start + 1);
  }

  return chunks;
}

function chunkText(rawText: string): ParsedChunk[] {
  const blocks = buildLogicalBlocks(rawText);
  const parsed: ParsedChunk[] = [];
  let idx = 0;

  for (const block of blocks) {
    const body = block.lines.join("\n").trim();
    if (!body) continue;

    const refs = Array.from(block.references);
    const contextParts: string[] = [];
    if (block.section) contextParts.push(`Section ${block.section}`);
    if (block.clause_number) contextParts.push(`Clause ${block.clause_number}`);
    if (block.kind === "table") contextParts.push("Table");

    const contextLine = contextParts.join(" | ");
    const refsLine = refs.length ? `Referenced standards: ${refs.join(", ")}` : "";
    const reserved = contextLine.length + refsLine.length + 16;
    const bodyChunkSize = Math.max(900, CHUNK_SIZE - reserved);
    const blockChunks = splitWithOverlap(body, bodyChunkSize, OVERLAP);

    for (const blockChunk of blockChunks) {
      const chunkText = [contextLine, blockChunk, refsLine].filter(Boolean).join("\n").trim();
      parsed.push({
        text: chunkText,
        chunk_index: idx++,
        clause_number: block.clause_number,
        clause_title: block.clause_title,
        page_number: null,
      });
    }
  }

  return parsed;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, serviceRoleKey);

    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.replace("Bearer ", "") : null;
    const { standard_id, user_id: internalUserId } = await req.json();

    if (!standard_id) {
      return new Response(JSON.stringify({ error: "standard_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let userId: string | null = null;

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

    const { data: standard, error: stdErr } = await supabaseAdmin
      .from("standards")
      .select("id, user_id, file_path")
      .eq("id", standard_id)
      .eq("user_id", userId)
      .single();

    if (stdErr || !standard) {
      return new Response(JSON.stringify({ error: "Standard not found" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabaseAdmin.from("standards").update({ extraction_status: "processing" }).eq("id", standard_id);

    const { data: fileData, error: dlErr } = await supabaseAdmin.storage.from("standards").download(standard.file_path!);
    if (dlErr || !fileData) {
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Failed to download file" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const fileBytes = new Uint8Array(await fileData.arrayBuffer());

    let rawText: string;
    try {
      rawText = await extractText(fileBytes);
    } catch (e) {
      console.error("Extraction failed:", e);
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "Could not extract readable text from this PDF." }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chunks = chunkText(rawText);
    const totalChunks = chunks.length;

    if (totalChunks === 0) {
      await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
      return new Response(JSON.stringify({ error: "No meaningful text found in document." }), {
        status: 422,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await supabaseAdmin
      .from("standard_chunks")
      .delete()
      .eq("standard_id", standard_id)
      .eq("user_id", userId);

    const BATCH_SIZE = 50;
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE);
      const records = batch.map((c) => ({
        standard_id,
        user_id: userId,
        content: c.text,
        chunk_index: c.chunk_index,
        is_indexed: false,
        embedding: null,
        clause_number: c.clause_number,
        clause_title: c.clause_title,
        page_number: c.page_number,
      }));

      const { error: insertErr } = await supabaseAdmin.from("standard_chunks").insert(records);
      if (insertErr) {
        console.error("Chunk insert error:", insertErr);
        await supabaseAdmin.from("standards").update({ extraction_status: "failed" }).eq("id", standard_id);
        return new Response(JSON.stringify({ error: "Failed to store extracted chunks" }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const qualityScore = rawText.length > 5000 ? 90 : rawText.length > 1000 ? 70 : 40;
    await supabaseAdmin
      .from("standards")
      .update({
        extraction_status: "complete",
        extraction_quality_score: qualityScore,
        total_chunks: totalChunks,
        indexed_chunks: 0,
      })
      .eq("id", standard_id);

    return new Response(
      JSON.stringify({
        status: "complete",
        total_chunks: totalChunks,
        raw_text_length: rawText.length,
        quality_score: qualityScore,
        chunks: chunks.map((c) => ({
          chunk_id: c.chunk_index,
          text: c.text.slice(0, 500) + (c.text.length > 500 ? "…" : ""),
          char_count: c.text.length,
          clause_number: c.clause_number,
          clause_title: c.clause_title,
          processed: false,
        })),
      }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  } catch (e) {
    console.error("Processing error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
