# Integration Notes — Where & How to Apply Changes

This document tells Claude Code **exactly** where each piece goes in the
StandAid codebase, and what to watch out for.

---

## File: `supabase/functions/query/index.ts`

This is the file that gets the most changes. Apply them in this order.

### Change 1 — Import the new helpers at the top of the file

At the top of `query/index.ts`, after the existing imports, add:

```ts
import { buildSystemPrompt, type TradeType } from "./system-prompt.ts";
import { detectTrade } from "./trade-detection.ts";
import { validateResponse } from "./validation.ts";
```

(Note: move the contents of `01-system-prompt.ts`, `02-trade-detection.ts`,
and `03-validation-v2.ts` into the same folder as `index.ts`, renamed as
shown above. Deno imports are file-path-based.)

### Change 2 — Replace the SYSTEM_PROMPT constant

**Delete** lines 13–69 (the existing `SYSTEM_PROMPT` constant).

You no longer need a static constant — you'll build the prompt per-query
using `buildSystemPrompt()`.

### Change 3 — Add query_log insertion before calling OpenAI

Before the `fetch("https://api.openai.com/v1/chat/completions", ...)` call
at line 228, insert a query_log row so you have a queryId to return:

```ts
// Detect trade context
const trade = detectTrade(userQuery, standardName);

// Build dynamic system prompt
const contextChunks = chunks
  .map((c, i) => `[Source ${i + 1} — ${c.metadata?.clause ?? "General"}]\n${c.content}`)
  .join("\n\n");

const systemPrompt = buildSystemPrompt(trade, contextChunks);

// Log the query up front so feedback can reference it
const { data: queryLog, error: logError } = await supabase
  .from("query_log")
  .insert({
    user_id: userId ?? null,
    query_text: userQuery,
    trade,
    standard_id: standardId ?? null,
    retrieved_chunk_ids: chunks.map(c => c.id).filter(Boolean),
    retrieved_chunk_count: chunks.length,
    model_used: "gpt-4o-mini",
  })
  .select("id")
  .single();

if (logError) {
  console.error("Failed to create query log:", logError);
  // Don't block the query — just log without an ID
}

const queryId = queryLog?.id;
```

### Change 4 — Update the OpenAI call to use the new system prompt

Replace the existing messages array:

```ts
// OLD
messages: [
  { role: "system", content: SYSTEM_PROMPT },
  { role: "user", content: userQuery },
]

// NEW
messages: [
  { role: "system", content: systemPrompt },
  { role: "user", content: userQuery },
]
```

### Change 5 — Replace the validation at line 275

**Delete** the existing citation-stripping regex logic at line 275.

After streaming completes (or as post-processing if not streaming), apply:

```ts
const validation = validateResponse({
  response: fullResponseText,
  chunks: chunks,
  query: userQuery,
  trade,
});

// Update the query_log row with validation metadata
if (queryId) {
  await supabase
    .from("query_log")
    .update({
      response_text: validation.cleanedResponse,
      confidence_score: validation.confidenceScore,
      validation_issues: validation.issues,
      needs_review: validation.needsReview,
    })
    .eq("id", queryId);
}

// If validation says block, send a safe fallback instead
if (validation.shouldBlock) {
  return new Response(
    JSON.stringify({
      error: "Unable to produce a reliable answer. Please try rephrasing.",
      queryId,
    }),
    { status: 200, headers: corsHeaders }
  );
}
```

### Change 6 — Return the queryId in the response

The frontend needs the queryId to submit feedback. Ensure the response
includes it — either as a JSON envelope or as a custom response header.

**Option A (JSON response, not streaming):**
```ts
return new Response(
  JSON.stringify({
    response: validation.cleanedResponse,
    queryId,
    confidenceScore: validation.confidenceScore,
    needsReview: validation.needsReview,
  }),
  { status: 200, headers: corsHeaders }
);
```

**Option B (streaming — preferred):**
Send the queryId as a custom HTTP header before streaming:
```ts
return new Response(readable, {
  headers: {
    ...corsHeaders,
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "X-Query-Id": queryId ?? "",
  },
});
```

The frontend reads `response.headers.get("X-Query-Id")` before consuming
the stream.

---

## Streaming Considerations

**IMPORTANT:** If the existing implementation uses streaming, you'll need
to accumulate the streamed text before validation. Two options:

### Option A — Validate after streaming completes (simpler)
Stream tokens to the client as they come in. After the stream closes,
run validation in the background and log to query_log. Downside: client
has already seen the unvalidated response.

### Option B — Validate before streaming (safer, higher latency)
Collect the full response first, validate, then stream the cleaned
version. Downside: user waits for full generation before seeing anything.

**Recommendation:** Option A for now. The validation is for:
1. Training data (what's logged)
2. Future review (via bad_responses_for_review view)
3. Frontend badge ("verified" vs "review")

The user still sees the response either way. Claude Code should choose
based on the existing streaming setup.

---

## Directory Structure After Changes

```
supabase/functions/
├── query/
│   ├── index.ts              ← modified
│   ├── system-prompt.ts      ← new (from 01-system-prompt.ts)
│   ├── trade-detection.ts    ← new (from 02-trade-detection.ts)
│   └── validation.ts         ← new (from 03-validation-v2.ts)
└── feedback/
    └── index.ts              ← new (from 04-feedback-function.ts)
```

---

## Deployment

After all changes applied:

```bash
# Deploy edge functions
supabase functions deploy query
supabase functions deploy feedback

# Run the migration
supabase db push
# or paste 05-feedback-schema.sql into Supabase SQL Editor
```

---

## Environment Variables

No new env vars required. The feedback function uses:
- `SUPABASE_URL` (already set)
- `SUPABASE_SERVICE_ROLE_KEY` (already set)

The query function continues to use:
- `OPENAI_API_KEY` (already set)
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`

---

## Test Checklist

After deployment, Claude Code should verify:

1. **Electrical query works:**
   - Query: "What's the max voltage drop on a sub-circuit?"
   - Expect: Answer cites AS/NZS 3000 Clause 2.3.2, confidence > 0.7,
     trade logged as 'electrical'

2. **Plumbing query routes correctly:**
   - Query: "What pressure do I test a water service at?"
   - Expect: Answer cites AS/NZS 3500.1, trade logged as 'plumbing'

3. **Safety warning auto-injects:**
   - Query involving "live testing" or "isolation"
   - Expect: Response contains ⚠️

4. **Hallucination stripped:**
   - If OpenAI returns a clause not in chunks, validation replaces it
   - Check query_log.validation_issues for 'hallucinated_citation'

5. **Feedback endpoint works:**
   - POST /functions/v1/feedback with valid body
   - Expect: 200 response, row in query_feedback table

6. **Review view works:**
   - Submit a "wrong" feedback
   - SELECT * FROM bad_responses_for_review
   - Expect: Row appears

7. **No regression:**
   - Existing queries still work
   - Streaming still delivers tokens progressively
   - No new console errors
