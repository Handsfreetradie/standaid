import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { extractPdfText } from "@/lib/pdf-text";
import { scanTooLargeForOcr } from "@/lib/scanned-check";
import {
  Upload, FileText, CheckCircle2, Loader2, ArrowLeft, ArrowRight,
  BookOpen, Zap, Search, Shield, Sparkles, ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter,
  AlertDialogTitle, AlertDialogDescription, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useStandards } from "@/hooks/useData";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

// Loose match so re-worded titles of the same standard still get caught
// (e.g. "Wiring Rules" vs "AS NZS 3000 2018 Electrical Installations (Wiring
// Rules)") — this is a soft warning, not a hard block, so false positives on
// short generic names are an acceptable trade-off.
function normalizeStandardName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function findMatchingStandard<T extends { title: string; standard_code: string | null }>(
  newName: string,
  newCode: string,
  existing: T[],
): T | null {
  const normNew = normalizeStandardName(newName);
  const codeNew = newCode.trim().toLowerCase();

  for (const s of existing) {
    if (codeNew && s.standard_code && s.standard_code.trim().toLowerCase() === codeNew) {
      return s;
    }
    const normExisting = normalizeStandardName(s.title);
    if (normExisting === normNew) return s;
    if (normNew.length > 4 && normExisting.length > 4 &&
        (normExisting.includes(normNew) || normNew.includes(normExisting))) {
      return s;
    }
  }
  return null;
}

function findLikelyDuplicate(
  newName: string,
  newCode: string,
  existing: { title: string; standard_code: string | null }[],
): string | null {
  return findMatchingStandard(newName, newCode, existing)?.title ?? null;
}

// Cover-page scan (first few pages only, see extractPdfText's maxPages option)
// to guess a standard code and whether this document is an amendment, so the
// naming step doesn't rely on the user typing an accurate code/title. Soft
// signals only — always overridable, never silently trusted for the actual
// upload payload.
const STANDARD_CODE_RE = /\b(AS\s*\/\s*NZS|NZS|AS)\s+(\d{1,5}(?:\.\d{1,3})?)(?:\s*:\s*(\d{4}))?\b/i;
const NCC_CODE_RE = /\bNCC\s+(\d{4})\b/i;

function extractStandardCode(coverText: string): string | null {
  const m = coverText.match(STANDARD_CODE_RE);
  if (m) {
    const prefix = m[1].toUpperCase().replace(/\s*\/\s*/, "/");
    return `${prefix} ${m[2]}${m[3] ? `:${m[3]}` : ""}`;
  }
  const ncc = coverText.match(NCC_CODE_RE);
  return ncc ? `NCC ${ncc[1]}` : null;
}

const AMENDMENT_RE = /\b(Amendment\s+No\.?\s*\d+|Amdt\.?\s*\d+|Corrigendum(?:\s+No\.?\s*\d+)?)\b/i;

function detectAmendment(coverText: string): boolean {
  // "Incorporating Amendment No. N" describes a base standard's revision
  // history, not a standalone amendment document — strip it before matching.
  const cleaned = coverText.replace(/incorporat\w*\s+amendment[^\n]*/gi, "");
  return AMENDMENT_RE.test(cleaned);
}

// Supabase edge functions have a ~6MB body limit — drop extracted text above this
const MAX_EXTRACTED_BYTES = 1_400_000;

type Step = "intro" | "upload" | "naming" | "processing" | "success";

interface ProcessingProgress {
  stage: "reading" | "uploading" | "extracting" | "sorting" | "chunking" | "storing" | "done";
  percent: number;
  message: string;
}

const STAGE_LABELS: Record<string, string> = {
  reading: "Reading your PDF…",
  uploading: "Uploading to secure storage…",
  extracting: "Extracting text from document…",
  sorting: "Sorting content into sections…",
  chunking: "AI is chunking sections…",
  storing: "Storing chunks & generating embeddings…",
  done: "Processing complete!",
};

// Figure images used to be captured here: every FIGURE chunk's page was
// rendered whole to a JPEG and uploaded to the standard-figures bucket. That
// was removed — the images were uncropped full pages, the pass only ran during
// an interactive upload (it died if the tab was backgrounded) and never covered
// tables at all. Chat now crops the figure or table out of the PDF on demand
// (see StandardClipImage), which needs nothing stored and works retroactively
// on standards uploaded before this change.

const StandardsUpload = () => {
  const [step, setStep] = useState<Step>("intro");
  const [file, setFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");
  const [standardCode, setStandardCode] = useState("");
  const [progress, setProgress] = useState<ProcessingProgress>({
    stage: "extracting", percent: 0, message: STAGE_LABELS.extracting,
  });
  const [result, setResult] = useState<{ totalChunks: number; indexedChunks: number; quality: number } | null>(null);
  const [licenceConfirmed, setLicenceConfirmed] = useState(false);
  const [canBackground, setCanBackground] = useState(false);
  const [duplicateWarning, setDuplicateWarning] = useState<string | null>(null);
  const [isAmendment, setIsAmendment] = useState(false);
  const [amendsStandardId, setAmendsStandardId] = useState<string>("");
  const [coverScanNote, setCoverScanNote] = useState<string | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: existingStandards } = useStandards();
  const amendableStandards = (existingStandards || []).filter(
    (s: any) => !s.amends_standard_id && s.extraction_status === "complete"
  );

  // Mirror refs so the async cover-page scan (fired from handleFileSelect,
  // resolves later) always reads current values instead of a stale closure,
  // and so a manual edit — before or after the scan resolves — always wins.
  const fileTokenRef = useRef(0);
  const standardCodeRef = useRef(standardCode);
  const isAmendmentRef = useRef(isAmendment);
  const amendableStandardsRef = useRef(amendableStandards);
  const userEditedCodeRef = useRef(false);
  const userEditedAmendmentRef = useRef(false);
  useEffect(() => { standardCodeRef.current = standardCode; }, [standardCode]);
  useEffect(() => { isAmendmentRef.current = isAmendment; }, [isAmendment]);
  useEffect(() => { amendableStandardsRef.current = amendableStandards; }, [amendableStandards]);

  const isPdf = (f: File) =>
    f.type === "application/pdf" || /\.pdf$/i.test(f.name);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    // iOS hands back an empty type for files picked out of iCloud/Drive, so the
    // filename is the only reliable signal there. process-standard parses the
    // real bytes regardless, so a misnamed file still fails at extraction.
    if (!isPdf(selected)) {
      toast.error("Only PDF files are supported");
      return;
    }
    if (selected.size > 70 * 1024 * 1024) {
      toast.error("File must be under 70MB");
      return;
    }

    setFile(selected);
    // Pre-fill name from filename
    const name = selected.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
    setDocName(name);
    setStep("naming");

    // Cheap, non-blocking cover-page scan — first 5 pages only, no AI, just
    // regex — to guess the standard code and whether this is an amendment,
    // so the user isn't relying on a filename-derived name being accurate.
    const myToken = ++fileTokenRef.current;
    userEditedCodeRef.current = false;
    userEditedAmendmentRef.current = false;
    setCoverScanNote(null);

    extractPdfText(selected, () => {}, { maxPages: 5 })
      .then((coverText) => {
        if (fileTokenRef.current !== myToken) return; // superseded by a newer file pick
        const stripped = coverText.replace(/\[PAGE \d+\]/g, "").trim();
        if (!stripped) return; // no text layer (scanned) — nothing to detect

        const code = extractStandardCode(coverText);
        const isAmendmentDoc = detectAmendment(coverText);
        const notes: string[] = [];

        if (code && !userEditedCodeRef.current && !standardCodeRef.current.trim()) {
          setStandardCode(code);
          notes.push(`detected code "${code}"`);
        }

        if (isAmendmentDoc && !userEditedAmendmentRef.current && !isAmendmentRef.current) {
          setIsAmendment(true);
          const effectiveCode = code ?? standardCodeRef.current;
          const match = effectiveCode
            ? amendableStandardsRef.current.find(
                (s: any) => s.standard_code?.trim().toLowerCase() === effectiveCode.trim().toLowerCase(),
              )
            : null;
          if (match) {
            setAmendsStandardId(match.id);
            notes.push(`matched it as an amendment to "${match.title}"`);
          } else {
            notes.push("flagged this as an amendment — pick which standard it applies to below");
          }
        }

        if (notes.length) {
          setCoverScanNote(`Auto-filled from the document: ${notes.join(" and ")}. Double-check before continuing.`);
        }
      })
      .catch((err) => console.warn("Cover-page scan failed (non-fatal):", err));
  };

  const startProcessing = async (skipDuplicateCheck = false) => {
    if (!file) return;
    if (!session) {
      toast.error("Your session has expired — please sign in again.");
      return;
    }
    if (!docName.trim()) {
      toast.error("Give the document a name first.");
      return;
    }
    if (!licenceConfirmed) {
      toast.error("Please confirm you're licensed to upload this document.");
      return;
    }
    if (isAmendment && amendableStandards.length > 0 && !amendsStandardId) {
      toast.error("Select which standard this amendment applies to.");
      return;
    }

    if (!skipDuplicateCheck) {
      // Scope the check to the same group: a base upload only warns against
      // other base standards, an amendment only warns against other
      // amendments already linked to the same base standard — otherwise
      // "AS/NZS 3000 Amendment 2" would false-positive against the base
      // "AS/NZS 3000" standard it's meant to sit alongside.
      const comparisonSet = (existingStandards || []).filter((s: any) =>
        isAmendment ? s.amends_standard_id === amendsStandardId : !s.amends_standard_id,
      );
      const match = findLikelyDuplicate(docName, standardCode, comparisonSet);
      if (match) {
        setDuplicateWarning(match);
        return;
      }
    }

    setStep("processing");
    setProgress({ stage: "reading", percent: 5, message: STAGE_LABELS.reading });

    // Client-side PDF text extraction
    let extractedText = "";
    try {
      extractedText = await extractPdfText(file, (pct) => {
        setProgress({
          stage: "reading",
          percent: Math.round(5 + pct * 30),
          message: `Reading your PDF… (${Math.round(pct * 100)}%)`,
        });
      });
    } catch (e) {
      console.warn("Client-side PDF extraction failed, server will handle it:", e);
      extractedText = "";
    }

    // A big scanned copy is guaranteed to be refused server-side (OCR has a
    // 10MB ceiling) — tell the user now, before wasting the upload.
    if (scanTooLargeForOcr(extractedText, file.size)) {
      toast.error(
        "This looks like a long scanned copy — the pages are pictures rather than text, and scans this big can't be processed. Try a digital PDF version of the standard instead.",
        { duration: 10000 },
      );
      setStep("naming");
      return;
    }

    // Upload PDF directly to storage (bypasses the edge function body size limit)
    setProgress({ stage: "uploading", percent: 38, message: STAGE_LABELS.uploading });
    const filePath = `${session.user.id}/${crypto.randomUUID()}.pdf`;
    const { error: storageError } = await supabase.storage
      .from("standards")
      .upload(filePath, file, { contentType: "application/pdf" });

    if (storageError) {
      toast.error("Failed to upload file. Please try again.");
      setStep("naming");
      return;
    }

    setProgress({ stage: "chunking", percent: 52, message: STAGE_LABELS.chunking });

    const textToSend = extractedText && extractedText.length <= MAX_EXTRACTED_BYTES
      ? extractedText
      : undefined;

    // Oversized text can't ride in the function body (~6MB limit), but dropping
    // it forces the server to re-extract the whole PDF — the path that fails on
    // the biggest standards. Park it in storage next to the PDF and send the path.
    let textPathToSend: string | undefined;
    if (extractedText && !textToSend) {
      const textPath = filePath.replace(/\.pdf$/i, ".txt");
      const { error: textError } = await supabase.storage
        .from("standards")
        .upload(textPath, new Blob([extractedText], { type: "text/plain" }), {
          contentType: "text/plain",
        });
      if (textError) {
        console.warn("Extracted-text upload failed — server will re-extract from the PDF:", textError.message);
      } else {
        textPathToSend = textPath;
      }
    }

    try {
      const { data, error } = await supabase.functions.invoke("upload-standard", {
        body: {
          title: docName.trim(),
          standard_code: standardCode.trim() || undefined,
          file_path: filePath,
          extracted_text: textToSend,
          extracted_text_path: textPathToSend,
          amends_standard_id: isAmendment ? amendsStandardId : undefined,
        },
      });

      if (error) {
        // Clean up orphaned storage files
        await supabase.storage.from("standards").remove(
          textPathToSend ? [filePath, textPathToSend] : [filePath],
        );
        toast.error((error as any)?.context?.error || error.message || "Upload failed");
        setStep("naming");
        return;
      }

      setProgress({ stage: "storing", percent: 60, message: STAGE_LABELS.storing });

      // Poll for text processing completion
      const standardId = data.standard_id;
      const pollResult = await pollProcessing(standardId, session.user.id, (pct) => {
        setProgress({ stage: "storing", percent: 60 + pct * 0.30, message: STAGE_LABELS.storing });
      });

      setProgress({ stage: "done", percent: 100, message: STAGE_LABELS.done });
      setResult(pollResult);
      queryClient.invalidateQueries({ queryKey: ["standards"] });
      setStep("success");
    } catch (e: any) {
      if (e.message === "backgrounded") return; // navigated away gracefully
      toast.error(e.message || "Processing failed");
      setStep("naming");
    }
  };

  const pollProcessing = async (
    standardId: string,
    userId: string,
    onProgress: (fraction: number) => void
  ): Promise<{ totalChunks: number; indexedChunks: number; quality: number }> => {
    const maxAttempts = 300; // 15 min max (3s × 300)
    let stallKickTriggered = false;
    let pendingKickTriggered = false;

    for (let i = 0; i < maxAttempts; i++) {
      await delay(3000);

      // After 2 min, show the "continue in background" button
      if (i === 40) setCanBackground(true);

      const { data: job } = await (supabase as any)
        .from("processing_jobs")
        .select("status, error_message")
        .eq("standard_id", standardId)
        .single();

      // Rescue kick: upload-standard starts processing with one fire-and-forget
      // request — if that single request is lost, the job sits "pending"
      // forever (there is no server-side queue worker). Still pending after a
      // minute means it was lost; process-standard accepts direct user calls
      // and only picks up jobs still in "pending", so this can't double-run.
      if (!pendingKickTriggered && i >= 20 && (job as any)?.status === "pending") {
        pendingKickTriggered = true;
        console.log("Job still pending after 60s — kicking process-standard directly");
        supabase.functions.invoke("process-standard", { body: { standard_id: standardId } })
          .catch(e => console.warn("process-standard kick failed:", e));
      }

      const { data } = await supabase
        .from("standards")
        .select("extraction_status, total_chunks, indexed_chunks, extraction_quality_score")
        .eq("id", standardId)
        .single();

      if (!data) continue;

      // Stall detection: chunks created but none indexed after 3 min — kick embed-chunks
      if (!stallKickTriggered && i >= 60 && (data.total_chunks ?? 0) > 0 && (data.indexed_chunks ?? 0) === 0) {
        stallKickTriggered = true;
        console.log("Stall detected — triggering embed-chunks manually");
        supabase.functions.invoke("embed-chunks", { body: { standard_id: standardId, user_id: userId } })
          .catch(e => console.warn("embed-chunks kick failed:", e));
      }

      if ((job as any)?.status === "pending") {
        setProgress(prev => ({ ...prev, stage: "extracting", message: "Queued — waiting to start…" }));
      } else if (data.extraction_status === "processing" && (data.total_chunks ?? 0) > 0) {
        setProgress(prev => ({ ...prev, stage: "storing", message: "Indexing content…" }));
      } else if ((job as any)?.status === "processing") {
        setProgress(prev => ({ ...prev, stage: "storing", message: STAGE_LABELS.storing }));
      }

      if (data.extraction_status === "complete") {
        onProgress(1);
        return {
          totalChunks: data.total_chunks || 0,
          indexedChunks: data.indexed_chunks || 0,
          quality: data.extraction_quality_score || 0,
        };
      }

      if (data.extraction_status === "failed") {
        // The server writes specific, actionable failure reasons (copy-protected
        // PDF, daily budget, low quality) — show those, not a generic line that
        // invites doomed retries of the same file.
        throw new Error((job as any)?.error_message || "Processing failed. Try a different file.");
      }

      if (data.total_chunks && data.total_chunks > 0) {
        const indexedRatio = (data.indexed_chunks || 0) / data.total_chunks;
        onProgress(0.5 + indexedRatio * 0.5);
      } else {
        onProgress(Math.min(i / 20, 0.45));
      }
    }

    // Timed out — navigate away gracefully instead of showing an error
    queryClient.invalidateQueries({ queryKey: ["standards"] });
    toast.info("Still processing in the background — check your library in a few minutes.");
    navigate("/standards");
    throw new Error("backgrounded");
  };

  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // ── INTRO ──
  if (step === "intro") {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md mx-auto">
        <button
          onClick={() => navigate("/standards")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back to Standards
        </button>

        <div className="text-center mb-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Upload className="h-8 w-8 text-primary" />
          </div>
          <h1 className="font-display text-2xl font-extrabold text-foreground mb-2">
            Upload a Document
          </h1>
          <p className="text-sm text-muted-foreground">
            Uploading your documents lets the AI give you accurate, clause-specific answers instead of generic guidance.
          </p>
        </div>

        <div className="space-y-3 mb-8">
          {[
            { icon: Search, title: "Precise clause referencing", desc: "AI searches your exact document, not the internet" },
            { icon: Zap, title: "Faster answers", desc: "Pre-processed chunks mean instant lookups" },
            { icon: Shield, title: "Your data stays private", desc: "Only you can access your uploaded standards" },
          ].map(({ icon: Icon, title, desc }) => (
            <Card key={title} className="p-3 flex items-start gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-bold text-foreground">{title}</p>
                <p className="text-xs text-muted-foreground">{desc}</p>
              </div>
            </Card>
          ))}
        </div>

        <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
          <p className="text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
            Only upload documents you're legally entitled to use with AI — for example, a copy you've
            purchased or hold a valid licence for. Some publishers, including Standards Australia,
            don't permit AI/ML use of their content under their own terms. You're responsible for
            checking your document's licence before uploading — see our{" "}
            <button type="button" className="underline" onClick={() => navigate("/terms")}>Terms of Service</button>.
          </p>
        </div>

        <Button className="w-full h-12 font-bold rounded-xl gap-2" onClick={() => setStep("upload")}>
          <Upload className="h-4 w-4" />
          Upload PDF
        </Button>
      </div>
    );
  }

  // ── FILE UPLOAD ──
  if (step === "upload") {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md mx-auto">
        <button
          onClick={() => setStep("intro")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <h2 className="font-display text-xl font-extrabold text-foreground mb-2">Select your document</h2>
        <p className="text-sm text-muted-foreground mb-6">
          PDF only, up to 70MB. Digital PDFs work best — very long scanned copies (photos of pages) can't be read.
        </p>

        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={handleFileSelect}
        />

        <Card
          className="border-dashed border-2 p-10 flex flex-col items-center justify-center cursor-pointer hover:border-primary/50 transition-colors"
          onClick={() => fileRef.current?.click()}
        >
          <FileText className="h-10 w-10 text-muted-foreground/40 mb-3" />
          <p className="text-sm font-semibold text-foreground mb-1">Tap to select a file</p>
          <p className="text-xs text-muted-foreground">PDF only</p>
        </Card>
      </div>
    );
  }

  // ── NAMING ──
  if (step === "naming") {
    // Same non-AI cover-scan regex used above, re-tested against whatever's
    // currently in the two fields (auto-filled or user-edited) so the banner
    // stays accurate live as the user types, not just at scan time.
    const detectedAsNzs = STANDARD_CODE_RE.test(docName) || STANDARD_CODE_RE.test(standardCode);
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md mx-auto">
        <button
          onClick={() => setStep("upload")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <h2 className="font-display text-xl font-extrabold text-foreground mb-2">Name your document</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Give it a recognisable name so you can find it later.
        </p>

        {file && (
          <Card className="p-3 flex items-center gap-3 mb-5">
            <FileText className="h-5 w-5 text-primary flex-shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024 / 1024).toFixed(1)} MB</p>
            </div>
          </Card>
        )}

        {coverScanNote && (
          <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-primary/5 border border-primary/20 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
            <p className="flex-1">{coverScanNote}</p>
            <button type="button" onClick={() => setCoverScanNote(null)} className="text-muted-foreground hover:text-foreground" aria-label="Dismiss">
              ✕
            </button>
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div>
            <Label className="text-sm">Document Name *</Label>
            <Input
              className="h-11 mt-1"
              placeholder="e.g. AS3000 Wiring Rules"
              value={docName}
              onChange={(e) => setDocName(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-sm">Standard Code (optional)</Label>
            <Input
              className="h-11 mt-1"
              placeholder="e.g. AS/NZS 3000:2018"
              value={standardCode}
              onChange={(e) => { setStandardCode(e.target.value); userEditedCodeRef.current = true; }}
            />
          </div>
        </div>

        <label className="flex items-start gap-3 mb-4 cursor-pointer">
          <Checkbox
            checked={isAmendment}
            onCheckedChange={(v) => {
              setIsAmendment(v === true);
              userEditedAmendmentRef.current = true;
              if (v !== true) setAmendsStandardId("");
            }}
            className="mt-0.5 flex-shrink-0"
          />
          <span className="text-xs text-muted-foreground leading-relaxed">
            This is an amendment to a standard I've already uploaded (e.g. "AS/NZS 3000 Amendment 2").
          </span>
        </label>

        {isAmendment && (
          <div className="mb-6">
            {amendableStandards.length > 0 ? (
              <>
                <Label className="text-sm">Which standard does this amend? *</Label>
                <Select value={amendsStandardId} onValueChange={(v) => { setAmendsStandardId(v); userEditedAmendmentRef.current = true; }}>
                  <SelectTrigger className="h-11 mt-1">
                    <SelectValue placeholder="Select a standard" />
                  </SelectTrigger>
                  <SelectContent>
                    {amendableStandards.map((s: any) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.title}{s.standard_code ? ` (${s.standard_code})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  The amendment's changes will take priority over the base standard when the AI answers.
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed">
                You don't have a base standard to link this to yet — it'll be uploaded as its own standard for now. Upload the base standard later and you'll be able to link this as an amendment to it.
              </p>
            )}
          </div>
        )}

        {detectedAsNzs && (
          <div className="mb-4 rounded-xl border border-amber-500/50 bg-amber-500/15 px-3.5 py-3 flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 text-amber-700 dark:text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-xs font-medium text-amber-700 dark:text-amber-500 leading-relaxed">
              We've detected this looks like an AS, AS/NZS or NZS document. Standards Australia's own
              terms don't permit AI/ML use of their content — that's between you and the publisher.
              Check your licence covers this before continuing.
            </p>
          </div>
        )}

        <div className="mb-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3.5 py-3">
          <p className="text-xs text-amber-700 dark:text-amber-500 leading-relaxed">
            AI-generated answers can be wrong — always verify anything safety-critical against the
            original document. You're responsible for having the right to upload and use this document
            with AI.
          </p>
        </div>

        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <Checkbox
            checked={licenceConfirmed}
            onCheckedChange={(v) => setLicenceConfirmed(v === true)}
            className="mt-0.5 flex-shrink-0"
          />
          <span className="text-xs text-muted-foreground leading-relaxed">
            I confirm I'm authorised to upload this document and use it with AI features under the
            publisher's terms, and I accept full responsibility for that — including verifying
            AI-generated answers and complying with any AI-use restrictions in the publisher's licence.
          </span>
        </label>

        <Button
          className="w-full h-12 font-bold rounded-xl gap-2"
          onClick={() => startProcessing()}
        >
          <Sparkles className="h-4 w-4" />
          Process Document
        </Button>

        <AlertDialog open={!!duplicateWarning} onOpenChange={(open) => { if (!open) setDuplicateWarning(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Looks like a duplicate</AlertDialogTitle>
              <AlertDialogDescription>
                You already have "{duplicateWarning}" in your library. Uploading another copy re-processes the
                whole document from scratch and may just give you two entries for the same standard. Upload anyway?
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => { setDuplicateWarning(null); startProcessing(true); }}>
                Upload anyway
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    );
  }

  // ── PROCESSING ──
  if (step === "processing") {
    const stages = ["reading", "uploading", "extracting", "sorting", "chunking", "storing", "done"];
    const currentIdx = stages.indexOf(progress.stage);

    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md mx-auto">
        <div className="text-center mb-8 mt-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
          </div>
          <h2 className="font-display text-xl font-extrabold text-foreground mb-2">Processing Document</h2>
          <p className="text-sm text-muted-foreground">{file?.name}</p>
        </div>

        <Progress value={progress.percent} className="mb-6 h-2" />

        <div className="space-y-3">
          {stages.filter(s => s !== "done").map((stage, idx) => {
            const isActive = idx === currentIdx;
            const isDone = idx < currentIdx;

            return (
              <div key={stage} className="flex items-center gap-3">
                {isDone ? (
                  <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
                ) : isActive ? (
                  <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0" />
                ) : (
                  <div className="h-5 w-5 rounded-full border-2 border-muted flex-shrink-0" />
                )}
                <p className={`text-sm ${isDone ? "text-foreground" : isActive ? "text-foreground font-semibold" : "text-muted-foreground"}`}>
                  {STAGE_LABELS[stage]}
                </p>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground text-center mt-8">
          {canBackground
            ? "Taking a while? Processing continues on our servers even if you close this page — check your library in a few minutes."
            : "This may take a minute depending on document size. Larger documents can be safely left to finish in the background."}
        </p>

        {canBackground && (
          <Button
            variant="outline"
            className="w-full h-11 mt-4 font-semibold rounded-xl gap-2"
            onClick={() => {
              queryClient.invalidateQueries({ queryKey: ["standards"] });
              toast.info("Still processing — check your library in a few minutes.");
              navigate("/standards");
            }}
          >
            Continue in background → View my library
          </Button>
        )}
      </div>
    );
  }

  // ── SUCCESS ──
  if (step === "success") {
    return (
      <div className="h-full overflow-y-auto px-5 py-6 pb-24 md:pb-8 max-w-md mx-auto">
        <div className="text-center mb-8 mt-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
          <h2 className="font-display text-xl font-extrabold text-foreground mb-2">Upload Complete!</h2>
          <p className="text-sm text-muted-foreground">Your standard is ready for AI-powered queries.</p>
        </div>

        {result && (
          <Card className="p-4 mb-6">
            <div className="grid grid-cols-2 gap-3">
              <div className="text-center">
                <p className="text-2xl font-extrabold text-foreground">{result.totalChunks}</p>
                <p className="text-xs text-muted-foreground">Clauses</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-primary">{result.indexedChunks}</p>
                <p className="text-xs text-muted-foreground">Indexed</p>
              </div>
            </div>
            {result.quality > 0 && (
              <div className="mt-3 pt-3 border-t border-border text-center">
                <p className="text-sm text-muted-foreground">
                  Extraction quality: <span className="font-bold text-foreground">{Math.round(result.quality)}%</span>
                </p>
              </div>
            )}
          </Card>
        )}

        <div className="space-y-3">
          <Button className="w-full h-12 font-bold rounded-xl gap-2" onClick={() => navigate("/chat")}>
            <BookOpen className="h-4 w-4" />
            Ask a Question
          </Button>
          <Button
            variant="outline"
            className="w-full h-12 font-bold rounded-xl gap-2"
            onClick={() => navigate("/standards")}
          >
            View Documents Library
          </Button>
        </div>
      </div>
    );
  }

  return null;
};

export default StandardsUpload;
