# Weekly Improvement Workflow

This is the "self-learning" loop. It's not automatic magic — it's a simple
20-minute weekly process that turns user feedback into better AI responses.

---

## Why This Works

Real self-learning AI (fine-tuning on feedback) needs:
- 100+ curated examples minimum
- Paid training runs ($20–$100+ per cycle)
- A/B testing infrastructure
- Ongoing quality assurance

**What this workflow gives you instead:**
- Real user feedback captured from day one
- A weekly review process Kyle can do in 20 minutes
- Continuous prompt and example improvements
- A training dataset that accumulates for fine-tuning later

**Accuracy improvement:** ~2–3% per week for the first 2 months, tapering
as the prompt matures. Realistic ceiling without fine-tuning: ~90%.

---

## Every Sunday (20 minutes)

### Step 1 — Export the week's bad responses (2 min)

Run this in Supabase SQL Editor:

```sql
SELECT *
FROM bad_responses_for_review
WHERE feedback_at >= NOW() - INTERVAL '7 days'
ORDER BY feedback_at DESC;
```

Export to CSV. Or use the Supabase dashboard's CSV export button.

### Step 2 — Check the weekly accuracy summary (1 min)

```sql
SELECT * FROM weekly_accuracy_summary;
```

This gives you a per-trade breakdown of:
- Total queries
- Helpful count
- Wrong count
- Unclear count
- Accuracy percentage

Track this week-over-week. It tells you whether you're improving.

### Step 3 — Categorise the bad responses (10 min)

For each row in the CSV, tag it with one of:

- **Wrong clause cited** → Prompt needs a more explicit citation rule
- **Correct but unclear** → Prompt needs better plain-English examples
- **Made up information** → Retrieval is returning wrong chunks (ingestion
  problem, not prompt problem — flag for separate fix)
- **Out of scope question** → Prompt needs better refusal language
- **Safety warning missing** → Validation needs more safety keywords

### Step 4 — Send the review to Claude (chat) (2 min)

Paste the categorised bad responses into Claude (in this chat interface)
with this message:

> Here are this week's bad responses from StandAid. Please suggest prompt
> updates for the ones that are prompt-related, and flag the ones that
> are retrieval/ingestion issues for me to fix separately.
>
> [paste CSV or list]

Claude will respond with specific prompt improvements — new examples to
add, rules to refine, edge cases to cover.

### Step 5 — Update the prompt (5 min)

Take Claude's suggestions and update either:
- `01-system-prompt.ts` → deploy as new version
- Add new examples to `EXAMPLES_BY_TRADE`
- Refine `TRADE_GUIDANCE` text

Deploy the updated edge function:
```bash
supabase functions deploy query
```

Done. Next week, check the accuracy summary again — it should move.

---

## Monthly (1 hour)

### Review what's accumulating for future fine-tuning

Once you have 500+ helpful-rated responses:

```sql
SELECT
  ql.query_text,
  ql.response_text,
  ql.trade
FROM query_log ql
INNER JOIN query_feedback qf ON qf.query_id = ql.id
WHERE qf.rating = 'helpful'
  AND qf.approved_for_training = TRUE
ORDER BY ql.created_at DESC;
```

These become your training dataset for a future fine-tune. Export to
JSONL in OpenAI's format and you have a foundation for a truly
custom StandAid model.

### Approving examples for training

Curate gold-standard responses by setting the flag:

```sql
UPDATE query_feedback
SET approved_for_training = TRUE
WHERE id IN (...);  -- specific IDs you've reviewed
```

Only approve responses you'd be happy to put in marketing materials —
these become the pattern the fine-tuned model learns from.

---

## Long-Term — When to Fine-Tune

You're ready to fine-tune when you have:
- 500+ approved training examples across trades
- Clear patterns in what users ask
- Consistent prompt that's been stable for 2+ weeks
- Budget for ~$50–$200 per training run

**Do not fine-tune before then.** Fine-tuning on bad/sparse data makes
your model worse, not better.

---

## What "Self-Learning" Actually Looks Like in Production

```
Week 1:  System prompt + 20 examples  →  78% accuracy
Week 2:  +5 examples from feedback    →  81% accuracy
Week 3:  +refined safety rules        →  83% accuracy
Week 4:  +plumbing examples           →  85% accuracy
Week 6:  +validation tightening       →  87% accuracy
Week 8:  +structural edge cases       →  88% accuracy
Week 10: Plateau around 89–90% with prompt alone
Week 12: First fine-tune → 93%+ (if you have the data)
```

This is how real production AI products improve. Not overnight, but
steadily and measurably.

---

## Key Metrics to Track

| Metric | Where | Target |
|---|---|---|
| Overall accuracy | `weekly_accuracy_summary` | Trending up week over week |
| Per-trade accuracy | `weekly_accuracy_summary` | All trades > 75% by month 2 |
| Average confidence score | `AVG(confidence_score) FROM query_log` | > 0.80 |
| Review queue size | `COUNT(*) FROM bad_responses_for_review` | < 20 open at any time |
| Hallucination rate | Issues with type='hallucinated_citation' | < 5% of queries |

---

## The Honest Promise

This workflow will not give you 95% accuracy tomorrow. Anyone who
tells you they can do that today is lying or about to charge you
a lot of money for something that will underperform.

What this gives you:
- Production-quality responses from day one (~80%)
- Measurable weekly improvement
- A dataset that becomes a moat as you scale
- A clear path to 90%+ accuracy within 8–10 weeks
- Foundation for a fine-tuned StandAid model once you have user traction

That's how you build an AI product that actually scales.
