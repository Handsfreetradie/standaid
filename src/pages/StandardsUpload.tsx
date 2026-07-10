import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import * as pdfjsLib from "pdfjs-dist";
import {
  Upload, FileText, CheckCircle2, Loader2, ArrowLeft, ArrowRight,
  BookOpen, Zap, Search, Shield, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// Supabase edge functions have a ~6MB body limit — drop extracted text above this
const MAX_EXTRACTED_BYTES = 1_400_000;

type Step = "intro" | "upload" | "naming" | "processing" | "success";

interface ProcessingProgress {
  stage: "reading" | "uploading" | "extracting" | "sorting" | "chunking" | "storing" | "figures" | "done";
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
  figures: "Extracting figure images…",
  done: "Processing complete!",
};

async function extractPdfText(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const numPages = pdf.numPages;
  let completed = 0;

  const pageTexts = await Promise.all(
    Array.from({ length: numPages }, async (_, i) => {
      const page = await pdf.getPage(i + 1);
      const content = await page.getTextContent();

      // Reconstruct lines geometry-aware. The old fixed 3pt Y-grid split
      // same-line items across buckets (a decimal point 0.02pt off became its
      // own "line", turning 0.5 into 05) and join("") fused adjacent table
      // columns into one number. Instead: cluster by Y-gap relative to glyph
      // height, sort by X within each line, and insert spaces from the real
      // horizontal gap between items.
      interface Positioned { str: string; x: number; y: number; w: number; h: number }
      const items: Positioned[] = [];
      for (const item of content.items) {
        if (!("str" in item) || !item.str) continue;
        const t = (item as any).transform;
        items.push({
          str: item.str,
          x: t[4],
          y: t[5],
          w: (item as any).width ?? 0,
          h: (item as any).height || Math.hypot(t[2], t[3]) || 10,
        });
      }

      // Top-to-bottom, then left-to-right so clustering sees reading order.
      items.sort((a, b) => (b.y - a.y) || (a.x - b.x));

      const lines: Positioned[][] = [];
      let current: Positioned[] = [];
      let currentY = Infinity;
      for (const it of items) {
        // Same visual line if Y is within half a glyph height (min 2pt) —
        // tolerant of kerned runs and superscripts, unlike a fixed grid.
        const tol = Math.max(2, it.h * 0.5);
        if (current.length === 0 || Math.abs(it.y - currentY) <= tol) {
          current.push(it);
          if (current.length === 1) currentY = it.y;
        } else {
          lines.push(current);
          current = [it];
          currentY = it.y;
        }
      }
      if (current.length > 0) lines.push(current);

      const sortedLines = lines.map((line) => {
        line.sort((a, b) => a.x - b.x);
        let text = "";
        let prevEnd = Infinity;
        for (const it of line) {
          const gap = it.x - prevEnd;
          // A real word/column gap is a decent fraction of the glyph height;
          // kerned fragments of one word sit at gap ≈ 0 (or overlap).
          if (text && gap > Math.max(1, it.h * 0.12) && !text.endsWith(" ") && !it.str.startsWith(" ")) {
            text += " ";
          }
          text += it.str;
          prevEnd = it.x + it.w;
        }
        return text;
      });

      onProgress(++completed / numPages);
      return sortedLines.join("\n");
    }),
  );

  return pageTexts.map((text, i) => `\n[PAGE ${i + 1}]\n${text}`).join("");
}

async function extractAndUploadFigures(
  standardId: string,
  userId: string,
  file: File,
  onProgress: (msg: string) => void,
): Promise<number> {
  // Fetch figure chunks created by process-standard — these have page numbers
  const { data: figureChunks } = await supabase
    .from("standard_chunks")
    .select("clause_number, clause_title, page_number")
    .eq("standard_id", standardId)
    .ilike("clause_number", "FIGURE%")
    .not("page_number", "is", null);

  if (!figureChunks || figureChunks.length === 0) return 0;

  // Deduplicate by figure_number — keep first occurrence per figure
  const seen = new Set<string>();
  const unique = figureChunks.filter((c) => {
    const num = c.clause_number.replace(/^FIGURE\s+/i, "").trim();
    if (seen.has(num)) return false;
    seen.add(num);
    return true;
  });

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(buffer) }).promise;

  let uploaded = 0;
  for (const chunk of unique) {
    const figureNumber = chunk.clause_number.replace(/^FIGURE\s+/i, "").trim();
    const pageNum = chunk.page_number as number;

    onProgress(`Extracting Figure ${figureNumber} (${uploaded + 1}/${unique.length})…`);

    try {
      if (pageNum < 1 || pageNum > pdf.numPages) continue;

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: 1.5 });

      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;

      await page.render({ canvasContext: ctx, viewport }).promise;

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.88),
      );
      if (!blob) continue;

      // Keep under the 5MB bucket limit
      if (blob.size > 5 * 1024 * 1024) {
        console.warn(`Figure ${figureNumber} page image exceeds 5MB, skipping`);
        continue;
      }

      const safeName = figureNumber.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${userId}/${standardId}/${safeName}.jpg`;

      const { error: uploadError } = await supabase.storage
        .from("standard-figures")
        .upload(storagePath, blob, { contentType: "image/jpeg", upsert: true });

      if (uploadError) {
        console.warn(`Storage upload failed for Figure ${figureNumber}:`, uploadError.message);
        continue;
      }

      const { data: { publicUrl } } = supabase.storage
        .from("standard-figures")
        .getPublicUrl(storagePath);

      const { error: insertError } = await supabase.from("standard_figures").insert({
        standard_id: standardId,
        user_id: userId,
        figure_number: figureNumber,
        caption: chunk.clause_title || null,
        page_number: pageNum,
        image_url: publicUrl,
      });

      if (!insertError) uploaded++;
    } catch (e) {
      console.warn(`Failed to extract Figure ${figureNumber}:`, e);
    }
  }

  return uploaded;
}

const StandardsUpload = () => {
  const [step, setStep] = useState<Step>("intro");
  const [file, setFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");
  const [standardCode, setStandardCode] = useState("");
  const [progress, setProgress] = useState<ProcessingProgress>({
    stage: "extracting", percent: 0, message: STAGE_LABELS.extracting,
  });
  const [result, setResult] = useState<{ totalChunks: number; indexedChunks: number; quality: number; figuresExtracted: number } | null>(null);
  const [licenceConfirmed, setLicenceConfirmed] = useState(false);
  const [canBackground, setCanBackground] = useState(false);

  const fileRef = useRef<HTMLInputElement>(null);
  const { session } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    if (selected.type !== "application/pdf") {
      toast.error("Only PDF files are supported");
      return;
    }
    if (selected.size > 50 * 1024 * 1024) {
      toast.error("File must be under 50MB");
      return;
    }

    setFile(selected);
    // Pre-fill name from filename
    const name = selected.name.replace(/\.pdf$/i, "").replace(/[_-]/g, " ");
    setDocName(name);
    setStep("naming");
  };

  const startProcessing = async () => {
    if (!file || !session || !docName.trim() || !licenceConfirmed) return;

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

    if (extractedText && !textToSend) {
      console.warn(`Extracted text too large (${extractedText.length} chars) — server will re-extract from storage`);
    }

    try {
      const { data, error } = await supabase.functions.invoke("upload-standard", {
        body: {
          title: docName.trim(),
          standard_code: standardCode.trim() || undefined,
          file_path: filePath,
          extracted_text: textToSend,
        },
      });

      if (error) {
        // Clean up orphaned storage file
        await supabase.storage.from("standards").remove([filePath]);
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

      // Extract figure images from the PDF pages client-side
      setProgress({ stage: "figures", percent: 92, message: STAGE_LABELS.figures });
      let figuresExtracted = 0;
      try {
        figuresExtracted = await extractAndUploadFigures(
          standardId,
          session.user.id,
          file,
          (msg) => setProgress({ stage: "figures", percent: 92, message: msg }),
        );
      } catch (e) {
        console.warn("Figure extraction failed (non-fatal):", e);
      }

      setProgress({ stage: "done", percent: 100, message: STAGE_LABELS.done });
      setResult({ ...pollResult, figuresExtracted });
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

    for (let i = 0; i < maxAttempts; i++) {
      await delay(3000);

      // After 2 min, show the "continue in background" button
      if (i === 40) setCanBackground(true);

      const { data: job } = await (supabase as any)
        .from("processing_jobs")
        .select("status")
        .eq("standard_id", standardId)
        .single();

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
        throw new Error("Processing failed. Try a different file.");
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
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
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
            Upload a Standard
          </h1>
          <p className="text-sm text-muted-foreground">
            Uploading your standards lets the AI give you accurate, clause-specific answers instead of generic guidance.
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
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <button
          onClick={() => setStep("intro")}
          className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>

        <h2 className="font-display text-xl font-extrabold text-foreground mb-2">Select your document</h2>
        <p className="text-sm text-muted-foreground mb-6">PDF only, up to 50MB.</p>

        <input
          ref={fileRef}
          type="file"
          accept=".pdf"
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
    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
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
              onChange={(e) => setStandardCode(e.target.value)}
            />
          </div>
        </div>

        <label className="flex items-start gap-3 mb-6 cursor-pointer">
          <Checkbox
            checked={licenceConfirmed}
            onCheckedChange={(v) => setLicenceConfirmed(v === true)}
            className="mt-0.5 flex-shrink-0"
          />
          <span className="text-xs text-muted-foreground leading-relaxed">
            I confirm I hold a valid licence or subscription for this document and am authorised to upload it in accordance with the publisher's terms of use.
          </span>
        </label>

        <Button
          className="w-full h-12 font-bold rounded-xl gap-2"
          disabled={!docName.trim() || !licenceConfirmed}
          onClick={startProcessing}
        >
          <Sparkles className="h-4 w-4" />
          Process Document
        </Button>
      </div>
    );
  }

  // ── PROCESSING ──
  if (step === "processing") {
    const stages = ["reading", "uploading", "extracting", "sorting", "chunking", "storing", "figures", "done"];
    const currentIdx = stages.indexOf(progress.stage);

    return (
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
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
            ? "Large documents take longer — it's safe to leave this running."
            : "This may take a minute depending on document size."}
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
      <div className="px-5 py-6 pb-24 max-w-md mx-auto">
        <div className="text-center mb-8 mt-8">
          <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-8 w-8 text-primary" />
          </div>
          <h2 className="font-display text-xl font-extrabold text-foreground mb-2">Upload Complete!</h2>
          <p className="text-sm text-muted-foreground">
            Your standard is ready for AI-powered queries.
          </p>
        </div>

        {result && (
          <Card className="p-4 mb-6">
            <div className="grid grid-cols-3 gap-3">
              <div className="text-center">
                <p className="text-2xl font-extrabold text-foreground">{result.totalChunks}</p>
                <p className="text-xs text-muted-foreground">Clauses</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-primary">{result.indexedChunks}</p>
                <p className="text-xs text-muted-foreground">Indexed</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-extrabold text-foreground">{result.figuresExtracted}</p>
                <p className="text-xs text-muted-foreground">Figures</p>
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
            View Standards Library
          </Button>
        </div>
      </div>
    );
  }

  return null;
};

export default StandardsUpload;
