# StandAid AI Upgrade — Claude Code Brief

## Context

You are the Lead Engineer on StandAid, an AI-powered app that helps Australian
tradies query Australian Standards (AS/NZS) by voice or text. The current system
works but needs upgrading to production-grade quality across multiple trades.

**Current state:**
- OpenAI API call: `supabase/functions/query/index.ts:228`
- System prompt: lines 13–69 of that file (single `SYSTEM_PROMPT` constant)
- Model: `gpt-4o-mini`
- Citation validation: basic regex check at line 275
- No multi-trade routing, no feedback loop, no semantic validation

**Goal:** Ship an upgrade today that takes the AI quality from ~60% to ~80%
accuracy, with a feedback loop that improves it 2–3% per week automatically.

---

## What You're Building

Four changes to `supabase/functions/query/index.ts`, plus two new files and
one database migration. All files are provided in this package.

### Change 1 — Replace the system prompt
**File:** `supabase/functions/query/index.ts` lines 13–69
**Replace with:** Contents of `01-system-prompt.ts` (in this package)

### Change 2 — Add trade detection helper
**File:** `supabase/functions/query/index.ts`
**Add:** New helper function `detectTrade()` before the main handler
**Source:** `02-trade-detection.ts`

### Change 3 — Upgrade the validation layer
**File:** `supabase/functions/query/index.ts` line 275
**Replace with:** Contents of `03-validation-v2.ts`

### Change 4 — Add the feedback capture endpoint
**New file:** `supabase/functions/feedback/index.ts`
**Source:** `04-feedback-function.ts`

### Change 5 — Database migration
**Run this migration:** `05-feedback-schema.sql` via Supabase SQL editor
**Or:** Create a new migration file in `supabase/migrations/`

### Change 6 — Frontend feedback buttons
**File:** Wherever your chat response component lives
**Source:** `06-feedback-ui.tsx` (reference component — adapt to your existing UI)

---

## Your Operating Rules

You are the Lead Engineer. Kyle is the CEO. Follow StandAid conventions:

1. **Plan first.** Before writing any code, confirm:
   - You have read the current `supabase/functions/query/index.ts` file
   - You understand the existing structure and naming conventions
   - You've identified any conflicts between the new code and existing code
   - You have a step-by-step execution plan

2. **Check in at each checkpoint:**
   - CHECKPOINT 1: Plan approved by Kyle → start building
   - CHECKPOINT 2: Build complete + self-reviewed → present summary
   - CHECKPOINT 3: Tested and verified working → hand off

3. **Never break what works.** The existing citation validation (line 275) works —
   the upgrade replaces it with something better, but test that nothing regresses.

4. **Preserve streaming.** The existing response is streamed. Do not break streaming.

5. **Match the codebase style.** Read existing code first. Match its naming,
   error handling, and TypeScript patterns.

---

## Order of Operations

Execute in this exact order:

1. **Read the existing file:** `supabase/functions/query/index.ts`
2. **Present a plan to Kyle** confirming what you'll change and in what order
3. **Wait for Kyle's approval**
4. Apply Change 1 (system prompt)
5. Apply Change 2 (trade detection helper)
6. Apply Change 3 (validation v2)
7. Apply Change 4 (new feedback function)
8. Apply Change 5 (database migration)
9. Apply Change 6 (frontend feedback UI — only if frontend code exists in repo)
10. Test the full query flow end-to-end
11. Present Build Summary to Kyle

---

## Testing Before Handoff

Before declaring done, verify:

- [ ] A query to an electrical standard returns an answer with clause citation
- [ ] A query to a plumbing standard routes through the correct trade logic
- [ ] A query that should be refused (no relevant chunks) is refused cleanly
- [ ] The validation layer strips hallucinated clauses
- [ ] Streaming still works (response appears token by token)
- [ ] The feedback endpoint accepts POST and writes to the DB
- [ ] No TypeScript errors
- [ ] No console errors when invoked

---

## What's NOT in Scope (Don't Build These)

- Image/table extraction pipeline (separate project, 3–5 days)
- Auto-retraining on feedback (needs 100+ feedback rows first)
- Fine-tuning (not yet)
- New UI components beyond feedback buttons
- Changes to the embedding pipeline
- Changes to the chunking strategy

---

## Files in This Package

| File | Purpose |
|---|---|
| `CLAUDE_CODE_BRIEF.md` | This file — the orchestration brief |
| `01-system-prompt.ts` | New multi-trade system prompt with examples |
| `02-trade-detection.ts` | Helper to detect which trade a query belongs to |
| `03-validation-v2.ts` | Upgraded citation + safety validation |
| `04-feedback-function.ts` | New Supabase edge function for feedback capture |
| `05-feedback-schema.sql` | Database migration for feedback table |
| `06-feedback-ui.tsx` | Reference React component for feedback buttons |
| `07-integration-notes.md` | Exact paste locations and integration gotchas |
| `08-weekly-improvement-workflow.md` | How Kyle exports feedback weekly to improve prompt |

---

## Success Criteria

You're done when:

- All changes applied, tested, streaming works
- Feedback endpoint returns 200 on a test POST
- Kyle can query any trade and get a properly cited answer
- A deliberately bad answer is flagged by validation
- Build summary delivered to Kyle

Now read `supabase/functions/query/index.ts` and present your plan.
