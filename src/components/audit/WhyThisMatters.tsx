import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, ExternalLink, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getLabelRefs } from "@/lib/auditRefs";

// "Why this matters" for an audit photo: the NCC clauses and StandAId clause
// guides hand-mapped to the photo's label (src/lib/auditRefs.ts), pulled live
// from the shared indexes. Same attribution rules as chat: NCC text is
// © ABCB CC BY 4.0 and links to ncc.abcb.gov.au; guides are simplified
// summaries, never the standard's text. Renders nothing if the label has no
// mapping or nothing is live.

interface NccRow { id: string; clause_number: string; clause_title: string | null; content: string; source_url: string | null; state: string | null; publication: string; }
interface GuideRow { id: string; standard_code: string; clause_ref: string; title: string; summary: string; key_values: Array<{ label: string; value: string }>; }

const PUB_LABEL: Record<string, string> = {
  vol1: "Volume One", vol2: "Volume Two", vol3: "Volume Three", housing: "Housing Provisions", livable: "Livable Housing", glossary: "Definitions",
};

// Drop the header lines the ingest prepends ("NCC 2025 …, Part …\n<clause> <title>\n\n").
const bodyOf = (content: string) => content.split("\n\n").slice(1).join("\n\n") || content;

export function WhyThisMatters({ trade, label, states }: { trade: string | null | undefined; label: string | null | undefined; states: string[] }) {
  const refs = getLabelRefs(trade, label);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [ncc, setNcc] = useState<NccRow[] | null>(null);
  const [guides, setGuides] = useState<GuideRow[] | null>(null);

  useEffect(() => {
    if (!open || !refs || ncc !== null) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // ncc_chunks / clause_guides aren't in the generated Database types yet.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const sb = supabase as any;
        const [n, g] = await Promise.all([
          refs.ncc.length
            ? sb.from("ncc_chunks")
                .select("id, clause_number, clause_title, content, source_url, state, publication")
                .in("clause_number", refs.ncc)
                .eq("chunk_type", "text").eq("chunk_index", 0)
                .or(states.length ? `state.is.null,state.in.(${states.join(",")})` : "state.is.null")
            : Promise.resolve({ data: [] }),
          refs.guides.length
            ? sb.from("clause_guides")
                .select("id, standard_code, clause_ref, title, summary, key_values")
                .in("clause_ref", refs.guides.map((r) => r.clause))
                .in("standard_code", [...new Set(refs.guides.map((r) => r.standard))])
            : Promise.resolve({ data: [] }),
        ]);
        if (cancelled) return;
        // Keep the mapping's order; a state variation sorts right after its national clause.
        const order = new Map(refs.ncc.map((c, i) => [c, i]));
        setNcc(((n.data || []) as NccRow[]).sort((a, b) => (order.get(a.clause_number)! - order.get(b.clause_number)!) || (a.state ? 1 : -1)));
        setGuides((g.data || []) as GuideRow[]);
      } catch (e) {
        console.error("[why-this-matters]", e);
        if (!cancelled) { setNcc([]); setGuides([]); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, refs, ncc, states]);

  if (!refs || (refs.ncc.length === 0 && refs.guides.length === 0)) return null;
  const empty = ncc !== null && (ncc.length + (guides?.length ?? 0)) === 0;

  return (
    <div className="rounded-lg border border-border">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-1.5 px-2.5 py-2 text-[11px] font-semibold text-foreground">
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        Why this matters — the rules behind “{label}”
      </button>
      {open && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          {empty && !loading && <p className="text-[11px] text-muted-foreground">No live reference content mapped for this yet.</p>}
          {(ncc || []).map((c) => (
            <div key={c.id} className="rounded-md bg-emerald-500/5 border border-emerald-600/20 p-2 space-y-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-semibold text-emerald-800 dark:text-emerald-300">
                  <span className="rounded-sm bg-emerald-600 px-1 text-[9px] font-bold uppercase text-white mr-1">NCC</span>
                  {c.clause_number} {c.clause_title ? `— ${c.clause_title}` : ""}{c.state ? ` (${c.state} variation)` : ""}
                  <span className="text-muted-foreground font-normal"> · {PUB_LABEL[c.publication] ?? c.publication}</span>
                </p>
                {c.source_url && (
                  <a href={c.source_url} target="_blank" rel="noopener noreferrer" className="text-emerald-700 dark:text-emerald-300 shrink-0" title="Open on ncc.abcb.gov.au">
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                )}
              </div>
              <p className="text-[11px] text-foreground whitespace-pre-line line-clamp-[12]">{bodyOf(c.content)}</p>
            </div>
          ))}
          {(guides || []).map((g) => (
            <div key={g.id} className="rounded-md bg-amber-500/5 border border-amber-500/30 p-2 space-y-1">
              <p className="text-[11px] font-semibold text-amber-800 dark:text-amber-300">
                <span className="rounded-sm bg-amber-500 px-1 text-[9px] font-bold uppercase text-white mr-1">Guide</span>
                {g.standard_code} {g.clause_ref} — {g.title}
              </p>
              <p className="text-[11px] text-foreground">{g.summary}</p>
              {g.key_values?.length > 0 && (
                <ul className="text-[11px] text-muted-foreground">
                  {g.key_values.map((kv, i) => <li key={i}><span className="font-medium text-foreground">{kv.label}:</span> {kv.value}</li>)}
                </ul>
              )}
              <p className="text-[10px] text-muted-foreground">Simplified summary — verify against the current {g.standard_code} clause.</p>
            </div>
          ))}
          {(ncc?.length ?? 0) > 0 && (
            <p className="text-[10px] text-muted-foreground">
              The National Construction Code 2025 was provided by the Australian Building Codes Board under the{" "}
              <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer" className="underline">CC BY 4.0 licence</a>.
              Text extracted and reformatted; not professional advice — check the current edition on ncc.abcb.gov.au.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
