# StandAId Launch Checklist

## Pre-Launch (You do this)

### 1. Backend Deployment
- [ ] Deploy Site Audit migration: `supabase db push`
- [ ] Deploy analyze-audit-photo function: `supabase functions deploy analyze-audit-photo`
- [ ] Deploy performance indices: `supabase db push` (includes pgvector + FK indices)

### 2. Sentry Setup (Error Tracking)
- [ ] Create account at https://sentry.io (free tier is fine for launch)
- [ ] Create a new project → select "React"
- [ ] Copy your DSN
- [ ] Add to `.env.local`: `VITE_SENTRY_DSN=https://xxx@sentry.io/nnn`

### 3. Environment Variables
Verify you have all required vars in `.env.local`:
```
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
VITE_SENTRY_DSN=https://xxx@sentry.io/nnn
```

---

## Launch Day (5 checklist items)

### ✅ 1. Test PDF Offline Viewing
- [ ] Go to Standards, open a PDF
- [ ] Enable airplane mode
- [ ] Verify the PDF still loads from cache
- [ ] Turn airplane mode off

**What to look for:** PDF displays, no error about missing file

### ✅ 2. Test Site Audit (Pro feature)
- [ ] Go to Tools → Site Audit
- [ ] Create a new audit
- [ ] Add a photo (Switchboard, Main switch, etc.)
- [ ] Watch the progress bar
- [ ] Verify analysis completes
- [ ] Respond to "The AI needs to know" questions
- [ ] Re-assess with your answers

**What to look for:**
- Progress bar appears and updates
- Analysis takes 5–10 seconds
- Severity badge appears (✅, ⚠️, ❌)
- Q&A loop works

### ✅ 3. Test Error Recovery
- [ ] Go to Chat
- [ ] Ask a question
- [ ] Disable WiFi mid-response (if possible)
- [ ] Verify error message says "Lost connection, retrying..." or similar
- [ ] Re-enable WiFi and check it retries

**What to look for:** Friendly error messages, not "undefined" or "Request failed"

### ✅ 4. Monitor Sentry
- [ ] Open https://sentry.io/yourproject/
- [ ] Do something that should error (upload huge file, hit rate limit)
- [ ] Verify the error appears in Sentry within 30 seconds

**What to look for:** Errors logged, stack traces captured

### ✅ 5. Load Test on 3G
- [ ] Open DevTools → Network → throttle to "Fast 3G"
- [ ] Upload a large PDF (>10 MB)
- [ ] Watch the progress bar update
- [ ] Verify it completes without timing out

**What to look for:** Doesn't hang, shows reasonable progress, completes

---

## Post-Launch (First 48 Hours)

1. **Monitor Sentry constantly**
   - Any new error patterns?
   - High error rate?
   - Fix and redeploy immediately

2. **Test with real users (beta)**
   - Have 3–5 tradies try it
   - Collect feedback
   - Fix critical bugs before wider launch

3. **Track usage in analytics**
   - Which features are used most?
   - Where do users drop off?
   - Use for prioritization next sprint

---

## Rollback Plan (if something breaks badly)

1. **Frontend:** Revert to previous Vercel deployment (one click)
2. **Backend:** `supabase db reset` to rollback migrations (WARNING: loses data)
3. **Functions:** Redeploy previous version from git

---

## Success Criteria

✅ All 5 checklist items pass  
✅ No errors in Sentry for 24 hours  
✅ All features load in <3 seconds on 3G  
✅ Offline PDF viewer works  
✅ Progress indicators show during long operations  

You're live.
