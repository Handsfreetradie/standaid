import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, Loader2, Send, ClipboardCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { compressImageToBlob } from "@/lib/image";
import {
  summariseAudit, sortForReport, SEVERITY_META, getPhotoLabels, type AuditPhoto, type Severity,
} from "@/lib/audit";

const sb = supabase as any;

const toneClass: Record<string, string> = {
  danger: "bg-destructive/10 text-destructive border-destructive/20",
  warning: "bg-yellow-100 text-yellow-700 border-yellow-200",
  muted: "bg-muted text-muted-foreground border-border",
  success: "bg-primary/10 text-primary border-primary/20",
};

const AuditDetail = () => {
  const { id: auditId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [audit, setAudit] = useState<any>(null);
  const [photos, setPhotos] = useState<AuditPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const photoLabels = getPhotoLabels(audit?.trade);
  const [pendingLabel, setPendingLabel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    const [{ data: a }, { data: p }] = await Promise.all([
      sb.from("audits").select("*").eq("id", auditId).single(),
      sb.from("audit_photos").select("*").eq("audit_id", auditId).order("created_at", { ascending: true }),
    ]);
    setAudit(a);
    setPendingLabel((prev) => prev || getPhotoLabels(a?.trade)[0]);
    const list = (p || []) as AuditPhoto[];
    setPhotos(list);
    // Signed URLs for thumbnails (private bucket)
    const map: Record<string, string> = {};
    await Promise.all((p || []).map(async (row: any) => {
      const { data: signed } = await supabase.storage.from("audit-photos").createSignedUrl(row.storage_path, 3600);
      if (signed?.signedUrl) map[row.id] = signed.signedUrl;
    }));
    setUrls(map);
    setLoading(false);
  }, [auditId]);

  useEffect(() => { load(); }, [load]);

  const analyse = async (photoId: string) => {
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, status: "analyzing" } : p));
    try {
      const { data, error } = await supabase.functions.invoke("analyze-audit-photo", {
        body: { audit_id: auditId, photo_id: photoId },
      });
      if (error || data?.error) throw new Error(data?.error || "Analysis failed");
      setPhotos((prev) => prev.map((p) => p.id === photoId ? {
        ...p, status: "done",
        what_i_see: data.what_i_see, assessments: data.assessments || [],
        needs_to_know: data.needs_to_know || [], severity: data.severity,
      } : p));
    } catch (e: any) {
      toast.error(e.message?.includes("Pro") ? "Site Audit is a Pro feature." : "Couldn't analyse that photo.");
      setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, status: "failed" } : p));
    }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    setBusy(true);
    try {
      const blob = await compressImageToBlob(file);
      const path = `${user.id}/${auditId}/${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await supabase.storage.from("audit-photos").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (upErr) throw upErr;
      const { data: row, error: insErr } = await sb.from("audit_photos")
        .insert({ audit_id: auditId, user_id: user.id, storage_path: path, label: pendingLabel, status: "pending" })
        .select().single();
      if (insErr) throw insErr;
      const { data: signed } = await supabase.storage.from("audit-photos").createSignedUrl(path, 3600);
      if (signed?.signedUrl) setUrls((u) => ({ ...u, [row.id]: signed.signedUrl }));
      setPhotos((prev) => [...prev, row as AuditPhoto]);
      analyse(row.id); // kick analysis immediately
    } catch (e) {
      console.error(e);
      toast.error("Couldn't add that photo.");
    } finally {
      setBusy(false);
    }
  };

  const submitAnswers = async (photoId: string) => {
    const notes = answers[photoId]?.trim();
    if (!notes) return;
    await sb.from("audit_photos").update({ user_notes: notes }).eq("id", photoId);
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, user_notes: notes } : p));
    setAnswers((a) => ({ ...a, [photoId]: "" }));
    analyse(photoId); // re-run with the answers folded in
  };

  const deleteAudit = async () => {
    if (!window.confirm("Delete this audit? This cannot be undone.")) return;
    setDeleting(true);
    try {
      // Collect storage paths BEFORE deleting the row — audit_photos cascade-
      // deletes with the audit and the paths become unrecoverable after that.
      const { data: photoRows } = await sb.from("audit_photos").select("storage_path").eq("audit_id", auditId);

      const { error } = await sb.from("audits").delete().eq("id", auditId);
      if (error) throw error;

      try {
        const paths = (photoRows || []).map((p: any) => p.storage_path).filter(Boolean);
        if (paths.length > 0) await supabase.storage.from("audit-photos").remove(paths);
      } catch (e) {
        console.warn("Storage cleanup after audit delete failed (non-fatal):", e);
      }

      toast.success("Audit deleted");
      navigate("/audits");
    } catch (e) {
      console.error(e);
      toast.error("Couldn't delete the audit — please try again.");
      setDeleting(false);
    }
  };

  const summary = summariseAudit(photos);

  if (loading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }

  return (
    <div className="h-full overflow-y-auto px-5 py-6 pb-28 md:pb-10">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between -ml-2 mb-2">
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => navigate("/audits")}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Audits
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
            onClick={deleteAudit} disabled={deleting}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </Button>
        </div>
        <h1 className="text-xl font-extrabold text-foreground">{audit?.title}</h1>
        {audit?.site_address && <p className="text-xs text-muted-foreground mb-3">{audit.site_address}</p>}

        {/* Summary */}
        {summary.analysed > 0 && (
          <Card className="p-3 my-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-foreground">Report so far</span>
              {summary.overall && (
                <Badge className={`text-[10px] border ${toneClass[SEVERITY_META[summary.overall].tone]}`}>
                  {SEVERITY_META[summary.overall].icon} {SEVERITY_META[summary.overall].label}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-4 gap-1 text-center">
              {(["non_compliant", "concern", "cant_tell", "compliant"] as Severity[]).map((s) => (
                <div key={s} className="rounded-lg bg-muted/50 py-1.5">
                  <p className="text-base font-extrabold text-foreground">{summary.counts[s]}</p>
                  <p className="text-[9px] text-muted-foreground leading-tight">{SEVERITY_META[s].label}</p>
                </div>
              ))}
            </div>
            {summary.openQuestions > 0 && (
              <p className="text-[11px] text-yellow-700 mt-2">{summary.openQuestions} question(s) need answering below.</p>
            )}
          </Card>
        )}

        {/* Add photo */}
        <Card className="p-3 my-3">
          <p className="text-xs font-semibold text-foreground mb-2">Add a photo</p>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {photoLabels.map((l) => (
              <Badge key={l} variant={pendingLabel === l ? "default" : "outline"}
                className="cursor-pointer text-[11px] px-2 py-1" onClick={() => setPendingLabel(l)}>
                {l}
              </Badge>
            ))}
          </div>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={onFilePicked} />
          <Button className="w-full gap-1.5" onClick={() => fileRef.current?.click()} disabled={busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
            Capture {pendingLabel}
          </Button>
        </Card>

        {/* Photos */}
        <div className="space-y-3 mt-4">
          {sortForReport(photos).map((p) => (
            <Card key={p.id} className="overflow-hidden">
              {urls[p.id] && <img src={urls[p.id]} alt={p.label || "photo"} className="w-full max-h-64 object-cover" />}
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">{p.label}</span>
                  {p.status === "analyzing" && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
                  {p.status === "failed" && (
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => analyse(p.id)}>Retry</Button>
                  )}
                  {p.status === "done" && p.severity && (
                    <Badge className={`text-[10px] border ${toneClass[SEVERITY_META[p.severity].tone]}`}>
                      {SEVERITY_META[p.severity].icon} {SEVERITY_META[p.severity].label}
                    </Badge>
                  )}
                </div>

                {p.status === "done" && (
                  <>
                    {p.what_i_see && <p className="text-xs text-muted-foreground">{p.what_i_see}</p>}
                    {p.assessments?.length > 0 && (
                      <div className="space-y-1">
                        {p.assessments.map((a, i) => (
                          <div key={i} className="text-xs flex gap-1.5">
                            <span>{SEVERITY_META[a.verdict]?.icon ?? "•"}</span>
                            <span className="text-foreground">{a.point}{a.clause ? ` (${a.clause})` : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Q&A loop */}
                    {p.needs_to_know?.length > 0 && !p.user_notes && (
                      <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-2 space-y-1.5">
                        <p className="text-[11px] font-semibold text-yellow-800">The AI needs to know:</p>
                        {p.needs_to_know.map((q, i) => (
                          <p key={i} className="text-[11px] text-yellow-800">• {q}</p>
                        ))}
                        <textarea
                          value={answers[p.id] || ""}
                          onChange={(e) => setAnswers((a) => ({ ...a, [p.id]: e.target.value }))}
                          placeholder="Type your measurements / answers…"
                          rows={2}
                          className="w-full text-xs rounded-md border border-border bg-background px-2 py-1.5 mt-1 resize-none focus:outline-none focus:border-primary"
                        />
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => submitAnswers(p.id)} disabled={!answers[p.id]?.trim()}>
                          <Send className="h-3 w-3" /> Re-assess with answers
                        </Button>
                      </div>
                    )}
                    {p.user_notes && (
                      <p className="text-[11px] text-muted-foreground italic">Your notes: {p.user_notes}</p>
                    )}
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>

        {photos.length > 0 && (
          <p className="text-[11px] text-muted-foreground text-center mt-6 flex items-center justify-center gap-1">
            <ClipboardCheck className="h-3 w-3" />
            AI-assisted reference only — a licensed person must verify and sign off on site.
          </p>
        )}
      </div>
    </div>
  );
};

export default AuditDetail;
