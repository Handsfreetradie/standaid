# RAG Eval Sets

Ground-truth question sets for the `query` edge function, scored by
[`qa-runner.mjs`](../qa-runner.mjs). Each catches hallucinations by asserting a
value that **must** appear and values that **must not**.

## Run

```bash
# one set
SUPABASE_ACCESS_TOKEN=xxx node qa-runner.mjs evals/as3008.json

# everything
SUPABASE_ACCESS_TOKEN=xxx node qa-runner.mjs evals/*.json

# with password instead of a token
SUPABASE_EMAIL=you@x.com SUPABASE_PASSWORD=pw node qa-runner.mjs evals/as3000.json
```

The account you sign in as must own the relevant standard. If it doesn't, the
AI should **decline** — which the runner scores as a PASS (no hallucination),
unless the decline still smuggles in a wrong value.

## File format

A JSON array of:

| field | meaning |
|---|---|
| `text` | the tradie's question |
| `correct_values` | one of these **must** appear (case-insensitive); `[]` = don't check |
| `wrong_values` | any of these appearing = hallucination = FAIL |
| `clause_hints` | clauses the AI should cite (informational) |
| `safety` | `true` = answer must include a safety warning |

## Status — these are STARTER sets, expand them

- `as3017.json` — 12 questions, proven against the uploaded standard.
- `as3008.json` — 5 current-carrying-capacity values verified cell-by-cell
  against the vision-transcribed tables. Extend to cover every column/method.
- `as3000.json` — 3 bedrock facts, incl. one "don't fabricate" grounding check.

The goal is **50–100 per standard**, drawn from the transcribed rows in
`standard_tables`. The cheapest way to get there: pull each transcribed table,
turn every row into a "capacity of X = ?" question (ground truth is the cell),
and append. That generation touches the AI, so quote the cost before running it.
