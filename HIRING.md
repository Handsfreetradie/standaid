# StandAId — Looking for a Developer

## About StandAId

**StandAId** is a mobile app for Australian tradies (electricians, plumbers, etc.) to upload Australian Standards (AS/NZS documents) and get instant answers via AI-powered search and learning tools.

**The problem we solve:** Tradies need quick, reliable access to complex regulatory docs while on the job. Our app extracts standards into searchable chunks, lets users ask questions in natural language, and has a quiz feature for exam prep.

**Current status:** MVP is live with real users. We've just migrated from OpenAI to Claude API (June 2026). The app works, but the extraction pipeline has some rough edges we need a focused dev to fix.

---

## Tech Stack

- **Frontend:** React + TypeScript, Vercel hosting
- **Backend:** Supabase (PostgreSQL, Auth, Edge Functions)
- **AI:** Claude API (claude-opus-4-8) for extraction and Q&A
- **Vector search:** OpenAI embeddings (pgvector)
- **Storage:** Supabase Storage for PDFs

**What's already built:**
- Full upload → extraction → chunking → embedding pipeline
- Vector search + Claude context retrieval
- Figure extraction and description
- Quiz/learning feature
- Multi-turn conversation

---

## What Needs Fixing

### 1. Figure Detection Broken After Claude Migration

**Why it matters:** Figures are critical for tradies—wiring diagrams, safety rules, compliance checklists. Users upload AS/NZS 3000 (Wiring Rules) expecting all diagrams to be extracted and searchable.

**Root cause (likely):** Claude's text extraction produces different formatting than OpenAI. Our two-pass figure detection regex patterns don't match Claude's output.

**What we know:**
- Pass 1: Looks for captions on their own line (e.g., "FIGURE 3.1 — Resistance test")
- Pass 2: Looks for inline references (e.g., "see Figure 3.3 for...")
- Code location: `supabase/functions/process-standard/index.ts`, `sortIntoSections()` function (lines 492–548)
- Needs: Debug logging, regex tuning, or text normalization

**Your job:** Investigate why Claude's text format breaks the regex, fix the pattern matching, verify all figures are extracted.

---

### 2. Extraction Quality Issues

**Decimal stripping:** Numbers like "0.5 ohms" are extracted as "05 ohms" (leading zero inserted, decimal removed).

**Why it matters:** Electrical specs are precise. Wrong numbers = wrong answers = dangerous for tradies.

**What we know:**
- Happens in the extraction pipeline, likely during text normalization
- Affects QA test accuracy (AS/NZS 3017 test scores 67% due to this)
- Code location: `process-standard/index.ts`, around line 270

**Your job:** Find the normalisation code stripping decimals, fix it, re-run QA tests to verify.

---

### 3. Hallucination in Q&A

**The issue:** Sometimes Claude answers using training data instead of the uploaded standard.

**Why it matters:** Tradies need to trust that answers come from *their* standard, not AI memory.

**What we know:**
- QA test identified 2 questions where Claude hallucinated (Q7, Q9 in AS/NZS 3017 test)
- System prompt exists but may need tightening
- Code location: `supabase/functions/query/index.ts` system prompt

**Your job:** Review the system prompt, tighten the "refuse if not in context" logic, add better `answer_found` detection, re-run QA tests.

---

## What Success Looks Like

✅ All figures extracted from test standards (20+, not 3)  
✅ Decimals preserved in extracted text (0.5, not 05)  
✅ AS/NZS 3017 QA test passes 100% (12/12)  
✅ Figure count remains stable across re-uploads  

---

## Getting Started

1. **Clone the repo** (GitHub: Handsfreetradie/standaid)
2. **Read DEV.md** in the project root (full architecture + current issues)
3. **Read CLAUDE.md** (project philosophy + locked fixes to avoid)
4. **Pick one issue** from above and start with debug logging
5. **Deploy and test** — Supabase auto-deploys on git push

**Tech debt:** This is clean, straightforward work. No massive refactors needed. Just debug → fix → test.

---

## Why Join?

- **Real-world problem:** Actual users, real impact for tradies
- **Focused scope:** These 3 issues are scoped, fixable, testable
- **Good codebase:** Clean TypeScript, good error logging, QA tests already written
- **Australian context:** If you're interested in building for Aussie trades, this is it
- **Flexible:** Can be contract work, ongoing role, or single-issue contribution

---

## Contact

Interested? Reach out with:
- Your GitHub profile
- 1-2 examples of similar work (extraction, regex debugging, pipeline fixes)
- Preferred commitment level (hours/week, timeline, etc.)

**Email:** kyledixonelectrical@gmail.com

---

**TL;DR:** Claude migration broke figure extraction. Fix the regex, debug decimal-stripping, tighten hallucination prevention. QA tests provided. Clean codebase, real users, ~2-3 weeks of focused work.
