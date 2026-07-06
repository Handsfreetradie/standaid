# Backend Deployment Guide

## Prerequisites
- Supabase CLI installed: `npm install -g supabase`
- You're in the repo directory: `/home/user/standaid`
- You have your Supabase project credentials

## Step 1: Link Your Supabase Project

```bash
supabase link --project-id your-project-id
```

You'll be asked for your database password. Get it from:
- Supabase Dashboard → Settings → Database → Connection string
- Or: Supabase Dashboard → Project Settings → API → Service Role Secret

## Step 2: Deploy Migrations

This applies the Site Audit tables + performance indices:

```bash
supabase db push
```

What gets deployed:
- `audits` table (user audits)
- `audit_photos` table (photos + analysis results)
- `audit-photos` storage bucket (private, per-user isolation)
- `idx_chunks_embedding` — 100x faster pgvector search
- `idx_audits_user_id`, `idx_audit_photos_*` — faster queries
- `idx_ai_usage_user_kind` — rate limiting indices

**⏱️ Takes ~30 seconds**

## Step 3: Deploy Edge Functions

```bash
supabase functions deploy analyze-audit-photo
```

This deploys the AI vision analysis function that runs on Supabase.

What it does:
- Takes a photo + standard ID
- Retrieves relevant clauses from pgvector search
- Runs Claude vision analysis
- Returns verdict + measurements needed
- Stores results to audit_photos table

**⏱️ Takes ~10 seconds**

## Step 4: Verify Deployment

```bash
supabase functions list
```

You should see `analyze-audit-photo` in the list.

Check Supabase Dashboard:
- Tables → `audits`, `audit_photos` exist
- Storage → `audit-photos` bucket exists (private)
- Functions → `analyze-audit-photo` deployed

## Step 5: Test a Query

In Supabase Dashboard → SQL Editor:

```sql
SELECT COUNT(*) FROM audits;
SELECT COUNT(*) FROM audit_photos;
```

Both should return 0 (empty, which is correct for fresh deploy).

## Step 6: Verify Indices

```sql
SELECT schemaname, tablename, indexname 
FROM pg_indexes 
WHERE indexname LIKE 'idx_%';
```

You should see:
- `idx_chunks_embedding` (pgvector)
- `idx_audits_user_id`
- `idx_audit_photos_audit_id`
- `idx_audit_photos_status`
- `idx_query_log_user_kind`
- `idx_ai_usage_user_kind`
- `idx_chat_history_user`
- And others

## Troubleshooting

### "Permission denied" on db push
- You need the database password, not the API key
- Get it from Project Settings → Database → Connection string
- Look for the `password=...` part

### "Function already exists"
- Safe to ignore, it just updates the existing function
- Or: `supabase functions delete analyze-audit-photo` then redeploy

### "Connection refused"
- Make sure you're linked to the right project: `supabase projects list`
- Verify your DB is running in Supabase Dashboard

### Edge function times out
- Cold start is normal (first call takes 2–5s)
- Subsequent calls: <1s

## Next: Frontend Configuration

Once backend is deployed, the app needs to know the Supabase endpoint:

1. **Vercel Environment Variables** (for frontend)
   - `VITE_SUPABASE_URL` = your project URL
   - `VITE_SUPABASE_ANON_KEY` = anon key
   - (Already set if you used Vercel's Supabase integration)

2. **Local Testing** (.env.local)
   ```
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-anon-key
   VITE_SENTRY_DSN=https://xxx@sentry.io/nnn  (optional)
   ```

3. **Test the app:**
   - Frontend should already be live on Vercel (auto-deployed)
   - Try the Site Audit feature → should work now

## You're Done

Once this is complete:
- ✅ Site Audit backend is live
- ✅ Performance indices are active
- ✅ Ready to test the full app

Follow the LAUNCH.md checklist to verify everything works.
