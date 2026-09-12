import { useEffect, useState } from "react";
import { Loader2, Check, Pencil, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";

// Owner-only review panel for clause guides (Phase 2 of the content plan).
// Every guide starts as a draft; the SME reads the summary + source_notes,
// fixes wording if needed, and flips it live. Editing sends it back to draft.

interface Guide {
  id: string;
  standard_code: string;
  clause_ref: string;
  title: string;
  trade: string;
  topic: string;
  summary: string;
  key_values: Array<{ label: string; value: string }>;
  related_ncc: string[];
  keywords: string[];
  source_notes: string | null;
  is_live: boolean;
  reviewed_at: string | null;
  embedded: boolean;
}

export function ClauseGuidesPanel() {
  const [guides, setGuides] = useState<Guide[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; summary: string } | null>(null);
  const [filter, setFilter] = useState<"all" | "draft" | "live">("draft");

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-clause-guides", { body: { action: "list" } });
      if (error) throw error;
      setGuides(data?.guides ?? []);
    } catch (e) {
      console.error("[clause-guides] load:", e);
      toast.error("Couldn't load clause guides");
      setGuides([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const setLive = async (g: Guide, live: boolean) => {
    setBusyId(g.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-clause-guides", { body: { action: "set_live", id: g.id, is_live: live } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setGuides((prev) => (prev || []).map((x) => (x.id === g.id ? { ...x, is_live: live, reviewed_at: data.guide.reviewed_at ?? null } : x)));
      toast.success(live ? `${g.standard_code} ${g.clause_ref} is live` : `${g.clause_ref} back to draft`);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't update");
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusyId(editing.id);
    try {
      const { data, error } = await supabase.functions.invoke("admin-clause-guides", { body: { action: "update", id: editing.id, patch: { summary: editing.summary } } });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setGuides((prev) => (prev || []).map((x) => (x.id === editing.id ? { ...x, summary: editing.summary, is_live: false, reviewed_at: null, embedded: false } : x)));
      toast.success("Saved — back to draft until re-embedded and re-reviewed");
      setEditing(null);
    } catch (e) {
      toast.error((e as Error).message || "Couldn't save");
    } finally {
      setBusyId(null);
    }
  };

  const shown = (guides || []).filter((g) => (filter === "all" ? true : filter === "live" ? g.is_live : !g.is_live));
  const liveCount = (guides || []).filter((g) => g.is_live).length;

  return (
    <div className="px-3 pb-4 pt-1 space-y-3">
      <p className="text-xs text-muted-foreground">
        StandAId's own plain-English summaries of AS/NZS clauses — never the standard's text. Read the summary
        and the source notes, fix the wording if it's wrong, then flip it live. Nothing here reaches users
        until it's live; don't flip anything live before Murfett has signed off on the approach.
      </p>
      <div className="flex items-center gap-2 text-xs">
        {(["draft", "live", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 border ${filter === f ? "bg-primary text-primary-foreground border-primary" : "border-border text-muted-foreground"}`}
          >
            {f === "draft" ? `Drafts (${(guides || []).length - liveCount})` : f === "live" ? `Live (${liveCount})` : "All"}
          </button>
        ))}
      </div>
      {loading && (
        <div className="flex items-center justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      )}
      {!loading && guides && shown.length === 0 && <p className="text-xs text-muted-foreground">Nothing here.</p>}
      {!loading && shown.map((g) => (
        <div key={g.id} className="rounded-lg border border-border p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-foreground">
                {g.standard_code} <span className="font-mono">{g.clause_ref}</span> — {g.title}
              </p>
              <p className="text-[11px] text-muted-foreground">{g.trade} · {g.topic}{!g.embedded ? " · not embedded yet" : ""}</p>
            </div>
            <Badge variant={g.is_live ? "default" : "outline"} className="text-[10px] shrink-0">{g.is_live ? "LIVE" : "DRAFT"}</Badge>
          </div>
          {editing?.id === g.id ? (
            <div className="space-y-2">
              <Textarea
                value={editing.summary}
                onChange={(e) => setEditing({ id: g.id, summary: e.target.value })}
                className="text-xs min-h-[140px]"
              />
              <div className="flex gap-2">
                <Button size="sm" className="h-8 text-xs" disabled={busyId === g.id} onClick={saveEdit}>
                  {busyId === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Save
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => setEditing(null)}>
                  <X className="h-3.5 w-3.5" /> Cancel
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-xs text-foreground whitespace-pre-wrap">{g.summary}</p>
          )}
          {g.key_values?.length > 0 && (
            <ul className="text-[11px] text-muted-foreground space-y-0.5">
              {g.key_values.map((kv, i) => <li key={i}><span className="font-medium text-foreground">{kv.label}:</span> {kv.value}</li>)}
            </ul>
          )}
          {g.source_notes && (
            <p className="text-[11px] text-amber-700 dark:text-amber-300 whitespace-pre-wrap"><span className="font-semibold">Source notes / review:</span> {g.source_notes}</p>
          )}
          <div className="flex flex-wrap gap-2 pt-1">
            {!g.is_live ? (
              <Button size="sm" className="h-8 text-xs" disabled={busyId === g.id || !g.embedded} onClick={() => setLive(g, true)}>
                {busyId === g.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />} Reviewed — go live
              </Button>
            ) : (
              <Button size="sm" variant="outline" className="h-8 text-xs" disabled={busyId === g.id} onClick={() => setLive(g, false)}>
                Take offline
              </Button>
            )}
            {editing?.id !== g.id && (
              <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setEditing({ id: g.id, summary: g.summary })}>
                <Pencil className="h-3.5 w-3.5" /> Edit wording
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
