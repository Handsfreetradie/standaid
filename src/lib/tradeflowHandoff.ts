// Saving a finished rough-in plan back onto a TradeFlow job.
//
// TradeFlow opens StandAId with a one-off code in the address (after the #, so it never reaches a
// server or log). The code can only add PDFs to that one job, as that one person, for 2 hours — it
// reads nothing and shares no login. It is kept for this browser tab only.

const KEY = "tradeflow_handoff";
const TRADEFLOW_HANDOFF_URL = "https://kzxjmptixbdsfugoilgv.supabase.co/functions/v1/setout-handoff";
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

interface Handoff {
  code: string;
  jobReference: string | null;
  savedAt: number;
  /** The job reference has already been used to pre-fill a new plan, so don't do it again. */
  prefilled?: boolean;
}

function read(): Handoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Handoff;
    if (!parsed.code || Date.now() - parsed.savedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function write(handoff: Handoff) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(handoff));
  } catch {
    // Storage unavailable (private window) — the Save button just won't appear.
  }
}

/** Run once at startup, before routing: picks the code out of #tf=… (and the job number out of
 * ?jobReference=…) so they survive a sign-in redirect, then removes the code from the address bar. */
export function captureTradeflowHandoff() {
  const code = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("tf");
  if (!code) return;
  const jobReference = new URLSearchParams(window.location.search).get("jobReference");
  write({ code, jobReference, savedAt: Date.now() });
  window.history.replaceState(null, "", window.location.pathname + window.location.search);
}

/** The job this tab was opened from in TradeFlow, if any. */
export function getTradeflowJob(): { jobReference: string | null } | null {
  const handoff = read();
  return handoff ? { jobReference: handoff.jobReference } : null;
}

/** The job number to pre-fill a new plan with, once only (used when the address lost its query
 * string, e.g. after signing in). */
export function takeTradeflowJobReference(): string | null {
  const handoff = read();
  if (!handoff || handoff.prefilled || !handoff.jobReference) return null;
  write({ ...handoff, prefilled: true });
  return handoff.jobReference;
}

async function call(body: Record<string, unknown>) {
  const res = await fetch(TRADEFLOW_HANDOFF_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.message || json.error || "Couldn't reach TradeFlow");
  return json;
}

/** Uploads the plan PDF and attaches it to the TradeFlow job. Returns the job number. */
export async function saveReportToTradeflow(pdf: Blob, name: string): Promise<string | null> {
  const handoff = read();
  if (!handoff) throw new Error("Open the rough-in plan from the job in TradeFlow to save it there.");

  const prepared = await call({ action: "prepare", code: handoff.code });
  const upload = await fetch(prepared.uploadUrl, { method: "PUT", headers: { "Content-Type": "application/pdf" }, body: pdf });
  if (!upload.ok) throw new Error("The upload to TradeFlow didn't go through — please try again.");
  const done = await call({ action: "complete", code: handoff.code, path: prepared.path, name });
  return (done.jobNumber as string | null) ?? prepared.jobNumber ?? null;
}
