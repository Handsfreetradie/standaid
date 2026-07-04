# StandAId Developer Guide

## What is StandAId?

**StandAId** is a mobile-first app for Australian tradies (electricians, plumbers, etc.) to:

1. **Upload Australian Standards** (AS/NZS documents, NCC references)
2. **AI-powered extraction** — Claude AI chunks and indexes the standard for fast retrieval
3. **Voice & text search** — Ask questions about the standard in natural language
4. **Learning & exam prep** — Quiz feature to study and verify knowledge
5. **Onsite tools** — Real-time access to standards while on the job

**Target user:** Electrical tradies studying AS/NZS 3000 (Wiring Rules) and other Australian Standards for license exams and compliance.

---

## Tech Stack

### Frontend
- **Framework:** React + TypeScript
- **Build:** Vite
- **Hosting:** Vercel
- **Key packages:** Supabase JS client, React Query, shadcn/ui

### Backend
- **Database & Auth:** Supabase (PostgreSQL + Supabase Auth)
- **API:** Supabase Edge Functions (Deno-based serverless)
- **Hosting:** Supabase (auto-deployed)
- **AI:** Claude API (claude-opus-4-8) — replaced OpenAI in June 2026

### Data Pipeline
1. **User uploads PDF** → stored in Supabase Storage
2. **process-standard** edge function → extracts text with Claude AI, chunks into sections and figures
3. **embed-chunks** edge function → embeds chunks using OpenAI text-embedding-3-small (vector search)
4. **describe-figures** edge function → Claude Vision analyzes PDF figures, generates descriptions
5. **Database** → stores chunks with metadata (clause numbers, page numbers, embeddings)
6. **query** edge function → vector search + Claude context → natural language answers

---

## Architecture Overview

```
┌─────────────────┐
│  Mobile App     │
│  (React/TS)     │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│      Supabase Client JS             │
│  (Auth, DB, Storage, Functions)     │
└────────┬────────────────────────────┘
         │
    ┌────┴─────────────────────────┐
    │                              │
    ▼                              ▼
┌──────────────┐          ┌──────────────────┐
│   Auth       │          │  Database        │
│  (Email)     │          │  (PostgreSQL)    │
└──────────────┘          └──────────────────┘
                               │
         ┌─────────────────────┼─────────────────────┐
         │                     │                     │
         ▼                     ▼                     ▼
    ┌────────┐           ┌──────────┐          ┌──────────┐
    │Standards│          │Chunks    │          │Embeddings│
    │(metadata)          │(text+meta)          │(vectors) │
    └────────┘           └──────────┘          └──────────┘

┌────────────────────────────────────────────────────────┐
│         Supabase Edge Functions (Deno)                 │
├────────────────────────────────────────────────────────┤
│ • process-standard   → AI text extraction + chunking   │
│ • embed-chunks       → Vector embeddings (OpenAI)      │
│ • describe-figures   → Claude Vision figure analysis   │
│ • query              → Vector search + Claude answer   │
│ • fetch-pdf          → Signed URLs for PDF viewing     │
└────────────────────────────────────────────────────────┘
```

---

## Key Database Tables

### `standards`
Metadata about uploaded documents.
```sql
id, user_id, standard_code, version, file_path, 
extraction_status, created_at, updated_at
```

### `standard_chunks`
Extracted sections and figures from standards.
```sql
id, standard_id, clause_number, clause_title, content, 
page_number, embedding, is_indexed, created_at
```

### `profiles`
User profiles tied to Supabase auth.
```sql
id, email, created_at
```

### `processing_jobs`
Tracks long-running extraction jobs.
```sql
standard_id, status, error_message, completed_at
```

---

## How the App Works

### 1. Upload Flow
1. User selects PDF from device
2. Frontend validates file, gets license confirmation
3. Uploads to Supabase Storage
4. Creates `standards` record with `extraction_status = 'processing'`
5. Triggers `process-standard` edge function

### 2. Extraction Pipeline
**process-standard** function:
- Downloads PDF from Storage
- Uses Claude AI (claude-opus-4-8) to extract text
  - Two-pass OCR: first attempts `pdfjs`, then falls back to Claude vision if text is corrupted
  - Handles scanned/poor-quality PDFs via AI OCR
- **Two-pass figure detection:**
  - **Pass 1:** Finds figures with captions on their own line (e.g., "FIGURE 3.1 — Resistance test")
  - **Pass 2:** Finds inline figure references (e.g., "see Figure 3.3 for...")
- Chunks text into logical sections (by clause numbers)
- Stores chunks in `standard_chunks` with `is_indexed = false`
- Triggers `embed-chunks` function

**embed-chunks** function:
- Fetches all non-indexed chunks
- Embeds each with OpenAI `text-embedding-3-small`
- Stores embeddings in `standard_chunks.embedding` (pgvector)
- Sets `is_indexed = true`
- Triggers `describe-figures` function

**describe-figures** function:
- Finds all chunks where `clause_number LIKE 'FIGURE%'` and `is_indexed = false`
- Uses Claude Vision to analyze the PDF figure image
- Generates practical, tradie-friendly descriptions (no jargon)
- Updates chunk content with description
- Sets `is_indexed = true`
- Updates `standards.extraction_status = 'completed'`

### 3. Query Flow
User asks: _"What's the maximum earthing conductor resistance?"_

**query** function:
1. Embeds the question using OpenAI `text-embedding-3-small`
2. Vector search against `standard_chunks` embeddings
3. Retrieves top 5-10 relevant chunks
4. Constructs context prompt for Claude
5. Sends to Claude Opus with:
   - System prompt (tradie-friendly, Australian context)
   - Retrieved context chunks
   - User question
   - Conversation history (for multi-turn)
6. Streams response back to user
7. Returns `answer_found` flag (true if answer was grounded in the standard, false if Claude couldn't find relevant content)

### 4. Learning Feature
User takes a quiz on AS/NZS 3000:
- **capstone** function:
  - Loads the standard's extracted chunks
  - Uses Claude to generate exam-style questions + answer keys
  - Scores user responses against the standard
  - Returns feedback

---

## Current Issues & TODOs

### 🔴 HIGH PRIORITY

**1. Figure detection only returning 3 figures**
- **Status:** Reported by Kyle, post-Claude migration
- **Possible causes:**
  - Claude extraction producing different text format than OpenAI (figure captions not on separate lines)
  - Pass 2 regex not matching inline references in Claude's output
  - Encoding issues with special characters (em-dashes, etc.)
- **Fix needed:**
  - Debug `sortIntoSections()` function in `process-standard/index.ts` (lines 492–548)
  - Add logging to see which figures Pass 1 vs Pass 2 are finding
  - Compare Claude-extracted text with OpenAI text to spot format differences
  - May need to adjust `captionLinePattern` or `refPattern` regexes

**2. AS/NZS 3017:2007 QA test — 3 failures**
- **Status:** Test scored 67% (8/12 pass)
- **Why:** Standard not yet uploaded to Kyle's account
- **Failures:**
  - Q3: AI returned "05 ohms" — decimal stripped in extraction
  - Q7/Q9: AI used training memory instead of refusing (leaking hallucinations)
- **Fix needed:**
  - Upload AS/NZS 3017:2007 to StandAId account and re-run test
  - Fix decimal-stripping in extraction pipeline (line ~270 in process-standard)
  - Tighten `query` function's hallucination prevention (system prompt)

### 🟡 MEDIUM PRIORITY

**3. Stale chunks on re-processing**
- When user re-uploads same standard, old chunks aren't cleaned up
- Creates duplicate/conflicting content in search results
- **Fix:** Delete old chunks before re-processing, or add versioning

**4. PDF viewer figure linking**
- Figures extracted but no way to jump to them in the PDF viewer
- Partially addressed (PDFViewerModal now accepts `pageNumber` prop) but incomplete

**5. Performance on large PDFs**
- Standards with 600+ pages may timeout or produce truncated text
- Current `max_tokens: 2000` may be too low for final output
- Consider streaming extraction or longer timeouts

### 🟢 NICE TO HAVE

**6. Support for other Australian Standards**
- Currently optimized for AS/NZS 3000 (Wiring Rules)
- Should work for NCC, AS 1100, etc., but not tested
- May need custom system prompts per standard

**7. Voice input**
- App designed for voice-first tradies but currently text-only
- Consider Whisper API for transcription

---

## File Structure

```
standaid/
├── src/
│   ├── components/           # React components
│   │   ├── PDFViewerModal.tsx
│   │   ├── Chat.tsx
│   │   └── ...
│   ├── pages/
│   │   ├── Chat.tsx          # Main Q&A page
│   │   ├── Learn.tsx         # Quiz/learning
│   │   ├── StandardsUpload.tsx
│   │   └── ...
│   ├── hooks/
│   │   └── useAuth.tsx       # Supabase auth
│   └── index.css             # Global styles (locked fixes: chat-input-wrapper)
│
├── supabase/
│   ├── functions/
│   │   ├── process-standard/index.ts    # Extract + chunk (CLAUDE API)
│   │   ├── embed-chunks/index.ts        # Vector embeddings (OPENAI)
│   │   ├── describe-figures/index.ts    # Figure analysis (CLAUDE API)
│   │   ├── query/index.ts               # Q&A retrieval (CLAUDE API)
│   │   └── fetch-pdf/index.ts           # Signed URLs
│   ├── migrations/                      # SQL schema
│   └── config.toml                      # Supabase local dev
│
├── public/                              # Static assets
├── vercel.json                          # Vercel config
├── vite.config.ts                       # Frontend build config
├── package.json
├── CLAUDE.md                            # Instructions for this project
└── DEV.md                               # This file

```

---

## Local Development

### Frontend
```bash
npm install
npm run dev
# Runs on http://localhost:5173
```

### Backend (Supabase Edge Functions)
```bash
# Start local Supabase
supabase start

# Deploy functions to local Supabase
supabase functions deploy

# View logs
supabase functions logs process-standard --tail
```

### Testing
```bash
# QA test for AS/NZS 3017
SUPABASE_EMAIL=kyledixonelectrical@gmail.com \
SUPABASE_PASSWORD=<password> \
node qa-3017-test.mjs

# Expected: 12/12 pass (100%)
# (Requires AS/NZS 3017:2007 uploaded to account)
```

---

## Environment Variables

### Frontend (`.env.local`)
```
VITE_SUPABASE_URL=https://wyxeqkgpwkcckyntqcns.supabase.co
VITE_SUPABASE_ANON_KEY=<public key>
```

### Backend (Supabase secrets, via dashboard)
```
ANTHROPIC_API_KEY=<Claude API key>
OPENAI_API_KEY=<still used for embeddings>
```

---

## Important Locked Fixes (DO NOT REVERT)

These were broken repeatedly by automated file regeneration when the app was built with Lovable. Understand before changing:

### 1. Chat input position (`src/index.css` + `src/pages/Chat.tsx`)
- `.chat-input-wrapper` uses `!important` rules to prevent `pb-safe` padding inside
- BottomNav handles safe-area inset — adding padding again pushes input up on iPhone
- **Rule:** Never add `pb-safe` to elements inside `.chat-input-wrapper`

### 2. Sign out redirect (`src/hooks/useAuth.tsx` + `src/pages/Profile.tsx`)
- Both have `finally { window.location.href = "/auth" }` blocks
- Ensures redirect even if Supabase throws
- **Rule:** Never remove the `finally` redirect blocks

---

## Common Tasks

### Add a new standard
1. Upload via frontend
2. Monitor `standards.extraction_status` — wait for `completed`
3. Test via `/chat` page with a question
4. Check QA test if available

### Debug extraction
1. Check Supabase function logs: `supabase functions logs process-standard --tail`
2. Look for Claude API errors or truncation warnings
3. Verify PDF isn't corrupted (try opening in system viewer)
4. Check `max_tokens` in `process-standard` function

### Fix hallucination in answers
1. Review `query/index.ts` system prompt
2. Tighten `answer_found` detection logic
3. Test with QA suite before deploying

### Reprocess a standard
1. Delete all chunks for that standard_id from database
2. Delete from Storage
3. Re-upload via frontend (will retrigger pipeline)

---

## API Keys & Credentials

**Supabase Project:** wyxeqkgpwkcckyntqcns  
**GitHub Repo:** Handsfreetradie/standaid  
**Vercel:** Auto-deploys on push to main  

Keys stored in:
- Supabase Dashboard → Settings → API
- Supabase Dashboard → Edge Functions → Secrets
- Environment variables (frontend: `.env.local`, backend: secrets)

---

## Questions? Known Issues?

1. **Figure count wrong?** Check extraction logs in Supabase. May need regex adjustment post-Claude.
2. **Answers hallucinating?** Run QA test to identify patterns. Likely system prompt tweak needed.
3. **PDF upload stuck?** Check `processing_jobs` table for error messages.
4. **Slow search?** Vector embeddings working? Check `standard_chunks.embedding` column is populated.

---

## Next Steps for New Dev

1. Clone repo, run `npm install`
2. Set up local Supabase: `supabase start`
3. Read `CLAUDE.md` for project philosophy
4. Pick an issue from the HIGH PRIORITY section above
5. Run QA test to baseline current behavior
6. Make changes, test locally, push to git (auto-deploys to Vercel + Supabase)

Good luck! 🚀
