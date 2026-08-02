import { useEffect, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Camera, Loader2, Send, ClipboardCheck, Trash2, FileDown, CheckSquare, Square } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { compressImageToBlob } from "@/lib/image";
import {
  summariseAudit, sortForReport, SEVERITY_META, getPhotoLabels, type AuditPhoto, type Severity,
} from "@/lib/audit";
import { generateAuditReportPdf, urlToBase64, type ReportPhoto } from "@/lib/auditReport";
import MicButton from "@/components/MicButton";

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
  const { data: profile } = useProfile();
  const [audit, setAudit] = useState<any>(null);
  const [photos, setPhotos] = useState<AuditPhoto[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const photoLabels = getPhotoLabels(audit?.trade);
  const [pendingLabel, setPendingLabel] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pendingNote, setPendingNote] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // Sign-off + report
  const [signName, setSignName] = useState("");
  const [signLicence, setSignLicence] = useState("");
  const [signConfirmed, setSignConfirmed] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  useEffect(() => {
    if (!profile) return;
    const p = profile as any;
    setSignName((prev) => prev || p.display_name || "");
    setSignLicence((prev) => prev || p.licence_number || "");
  }, [profile]);

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
      const note = pendingNote.trim() || null;
      const { data: row, error: insErr } = await sb.from("audit_photos")
        .insert({ audit_id: auditId, user_id: user.id, storage_path: path, label: pendingLabel, status: "pending", user_notes: note })
        .select().single();
      if (insErr) throw insErr;
      const { data: signed } = await supabase.storage.from("audit-photos").createSignedUrl(path, 3600);
      if (signed?.signedUrl) setUrls((u) => ({ ...u, [row.id]: signed.signedUrl }));
      setPhotos((prev) => [...prev, row as AuditPhoto]);
      setPendingNote("");
      analyse(row.id); // kick analysis immediately — note (if any) is already on the row

      // New content invalidates any existing sign-off — it no longer covers
      // everything in the report.
      if (audit?.signed_off_at) {
        await sb.from("audits").update({ signed_off_by: null, signed_off_licence: null, signed_off_at: null }).eq("id", auditId);
        setAudit((a: any) => a ? { ...a, signed_off_by: null, signed_off_licence: null, signed_off_at: null } : a);
      }
    } catch (e) {
      console.error(e);
      toast.error("Couldn't add that photo.");
    } finally {
      setBusy(false);
    }
  };

  const submitAnswers = async (photoId: string) => {
    const newNote = answers[photoId]?.trim();
    if (!newNote) return;
    const existing = photos.find((p) => p.id === photoId)?.user_notes;
    // Accumulate rather than overwrite — each round (an answered question, or
    // something the tradie spotted that the AI missed) stays in context for
    // future re-analysis instead of erasing what came before.
    const notes = existing ? `${existing}\n${newNote}` : newNote;
    await sb.from("audit_photos").update({ user_notes: notes }).eq("id", photoId);
    setPhotos((prev) => prev.map((p) => p.id === photoId ? { ...p, user_notes: notes } : p));
    setAnswers((a) => ({ ...a, [photoId]: "" }));
    analyse(photoId); // re-run with the notes folded in

    // A correction can change findings just like a new photo would — the
    // sign-off no longer covers what's about to be re-assessed.
    if (audit?.signed_off_at) {
      await sb.from("audits").update({ signed_off_by: null, signed_off_licence: null, signed_off_at: null }).eq("id", auditId);
      setAudit((a: any) => a ? { ...a, signed_off_by: null, signed_off_licence: null, signed_off_at: null } : a);
    }
  };

  const buildAndDownloadReport = async (auditForReport: any) => {
    setGeneratingReport(true);
    try {
      const p = (profile as any) || {};
      let logoBase64: string | null = null;
      if (p.logo_storage_path) {
        const { data: signed } = await supabase.storage.from("business-logos").createSignedUrl(p.logo_storage_path, 3600);
        if (signed?.signedUrl) logoBase64 = await urlToBase64(signed.signedUrl);
      }

      const reportPhotos: ReportPhoto[] = await Promise.all(
        photos.map(async (photo) => ({
          ...photo,
          imageBase64: urls[photo.id] ? await urlToBase64(urls[photo.id]) : null,
        }))
      );

      const doc = await generateAuditReportPdf({
        audit: auditForReport,
        photos: reportPhotos,
        business: {
          name: p.business_name || p.display_name || null,
          licenceNumber: p.licence_number || null,
          logoBase64,
        },
      });
      const filename = `${(auditForReport.title || "audit-report").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pdf`;
      doc.save(filename);
    } catch (e) {
      console.error("[audit] report generation failed:", e);
      toast.error("Couldn't generate the report — please try again.");
    } finally {
      setGeneratingReport(false);
    }
  };

  const signOffAndDownload = async () => {
    if (!signName.trim() || !signConfirmed || generatingReport) return;
    setGeneratingReport(true);
    try {
      const signed_off_at = new Date().toISOString();
      const patch = { signed_off_by: signName.trim(), signed_off_licence: signLicence.trim() || null, signed_off_at };
      const { error } = await sb.from("audits").update(patch).eq("id", auditId);
      if (error) throw error;
      const updatedAudit = { ...audit, ...patch };
      setAudit(updatedAudit);
      await buildAndDownloadReport(updatedAudit);
      toast.success("Signed off and downloaded");
    } catch (e) {
      console.error("[audit] sign-off failed:", e);
      toast.error("Couldn't sign off — please try again.");
      setGeneratingReport(false);
    }
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
          <div className="flex items-start gap-1.5 mb-2">
            <textarea
              value={pendingNote}
              onChange={(e) => setPendingNote(e.target.value)}
              placeholder="Optional: describe what you see, or anything you want it to specifically check…"
              rows={2}
              className="flex-1 text-xs rounded-md border border-border bg-background px-2 py-1.5 resize-none focus:outline-none focus:border-primary"
            />
            <MicButton value={pendingNote} onChange={setPendingNote} className="mt-0.5" />
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
                    {/* Q&A loop — always available, not just when the AI has an
                        outstanding question, so the tradie can flag something
                        the AI missed entirely. */}
                    {p.user_notes && (
                      <p className="text-[11px] text-muted-foreground italic whitespace-pre-line">Your notes: {p.user_notes}</p>
                    )}
                    <div className="rounded-lg bg-yellow-50 border border-yellow-200 p-2 space-y-1.5">
                      {p.needs_to_know?.length > 0 && (
                        <>
                          <p className="text-[11px] font-semibold text-yellow-800">The AI needs to know:</p>
                          {p.needs_to_know.map((q, i) => (
                            <p key={i} className="text-[11px] text-yellow-800">• {q}</p>
                          ))}
                        </>
                      )}
                      <div className="flex items-start gap-1.5 mt-1">
                        <textarea
                          value={answers[p.id] || ""}
                          onChange={(e) => setAnswers((a) => ({ ...a, [p.id]: e.target.value }))}
                          placeholder="Answer a question, or tell it something it missed…"
                          rows={2}
                          className="flex-1 text-xs rounded-md border border-border bg-background px-2 py-1.5 resize-none focus:outline-none focus:border-primary"
                        />
                        <MicButton
                          value={answers[p.id] || ""}
                          onChange={(text) => setAnswers((a) => ({ ...a, [p.id]: text }))}
                          className="mt-0.5"
                        />
                      </div>
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={() => submitAnswers(p.id)} disabled={!answers[p.id]?.trim()}>
                        <Send className="h-3 w-3" /> Re-assess
                      </Button>
                    </div>
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>

        {photos.length > 0 && (
          <>
            <p className="text-[11px] text-muted-foreground text-center mt-6 flex items-center justify-center gap-1">
              <ClipboardCheck className="h-3 w-3" />
              AI-assisted reference only — a licensed person must verify and sign off on site.
            </p>

            <Card className="p-4 mt-4">
              {audit?.signed_off_at ? (
                <>
                  <p className="text-xs font-semibold text-foreground">
                    Signed off by {audit.signed_off_by} on{" "}
                    {new Date(audit.signed_off_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}
                  </p>
                  <Button
                    className="w-full gap-1.5 mt-3"
                    variant="outline"
                    disabled={generatingReport}
                    onClick={() => buildAndDownloadReport(audit)}
                  >
                    {generatingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                    Re-download report
                  </Button>
                  <p className="text-[11px] text-muted-foreground mt-2">Adding another photo will require signing off again.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-bold text-foreground mb-1">Sign off & download report</p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Confirm you've personally verified this on site before generating the PDF.
                  </p>
                  <div className="space-y-2.5">
                    <div>
                      <Label className="text-xs">Your name</Label>
                      <Input className="h-11 mt-1" value={signName} onChange={(e) => setSignName(e.target.value)} />
                    </div>
                    <div>
                      <Label className="text-xs">Licence number</Label>
                      <Input className="h-11 mt-1" value={signLicence} onChange={(e) => setSignLicence(e.target.value)} />
                    </div>
                    <button
                      type="button"
                      className="flex items-center gap-2 text-xs text-foreground"
                      onClick={() => setSignConfirmed((v) => !v)}
                    >
                      {signConfirmed ? <CheckSquare className="h-4 w-4 text-primary flex-shrink-0" /> : <Square className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
                      <span className="text-left">I confirm I have personally verified this installation on site</span>
                    </button>
                    <Button
                      className="w-full gap-1.5"
                      disabled={!signName.trim() || !signConfirmed || generatingReport}
                      onClick={signOffAndDownload}
                    >
                      {generatingReport ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
                      Sign off & download report
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </>
        )}
      </div>
    </div>
  );
};

export default AuditDetail;
