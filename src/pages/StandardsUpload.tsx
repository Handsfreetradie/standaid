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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).href;

type Step = "intro" | "upload" | "naming" | "processing" | "success";

interface ProcessingProgress {
  stage: "reading" | "extracting" | "sorting" | "chunking" | "storing" | "done";
  percent: number;
  message: string;
}

const STAGE_LABELS: Record<string, string> = {
  reading: "Reading your PDF…",
  extracting: "Extracting text from document…",
  sorting: "Sorting content into sections…",
  chunking: "AI is chunking sections…",
  storing: "Storing chunks & generating embeddings…",
  done: "Processing complete!",
};

async function extractPdfText(
  file: File,
  onProgress: (pct: number) => void,
): Promise<string> {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const numPages = pdf.numPages;
  const pageTexts: string[] = [];

  for (let p = 1; p <= numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();

    // Group text items by quantised Y coordinate to reconstruct lines
    const lineMap = new Map<number, string[]>();
    for (const item of content.items) {
      if (!("str" in item) || !item.str) continue;
      // PDF Y-axis origin is bottom-left; quantise to 3pt buckets for line grouping
      const y = Math.round((item as any).transform[5] / 3) * 3;
      if (!lineMap.has(y)) lineMap.set(y, []);
      lineMap.get(y)!.push(item.str);
    }

    // Sort descending (top of page first) and join each line
    const sortedLines = [...lineMap.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, words]) => words.join(""));

    pageTexts.push(sortedLines.join("\n"));
    onProgress(p / numPages);
  }

  return pageTexts.map((text, i) => `\n[PAGE ${i + 1}]\n${text}`).join("");
}

const StandardsUpload = () => {
  const [step, setStep] = useState<Step>("intro");
  const [file, setFile] = useState<File | null>(null);
  const [docName, setDocName] = useState("");
  const [standardCode, setStandardCode] = useState("");
  const [progress, setProgress] = useState<ProcessingProgress>({
    stage: "extracting", percent: 0, message: STAGE_LABELS.extracting,
  });
  const [result, setResult] = useState<{ totalChunks: number; indexedChunks: number; quality: number } | null>(null);

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
    if (!file || !session || !docName.trim()) return;

    setStep("processing");
    setProgress({ stage: "reading", percent: 5, message: STAGE_LABELS.reading });

    // Client-side PDF extraction — bypasses server-side DRM decryption issues
    let extractedText = "";
    try {
      extractedText = await extractPdfText(file, (pct) => {
        setProgress({
          stage: "reading",
          percent: Math.round(5 + pct * 30),
          message: `Reading your PDF… (${Math.round(pct * 100)}%)`,
        });
      });
      console.log(`Client extraction complete: ${extractedText.length} chars`);
    } catch (e) {
      console.warn("Client-side PDF extraction failed, server will handle it:", e);
      extractedText = "";
    }

    setProgress({ stage: "extracting", percent: 38, message: STAGE_LABELS.extracting });
    await delay(300);
    setProgress({ stage: "sorting", percent: 42, message: STAGE_LABELS.sorting });
    await delay(300);
    setProgress({ stage: "chunking", percent: 45, message: STAGE_LABELS.chunking });

    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", docName.trim());
      if (standardCode.trim()) formData.append("standard_code", standardCode.trim());
      if (extractedText) formData.append("extracted_text", extractedText);

      const { data, error } = await supabase.functions.invoke("upload-standard", {
        body: formData,
      });

      if (error) {
        toast.error((error as any)?.context?.error || error.message || "Upload failed");
        setStep("naming");
        return;
      }

      setProgress({ stage: "storing", percent: 60, message: STAGE_LABELS.storing });

      // Poll for processing completion
      const standardId = data.standard_id;
      const pollResult = await pollProcessing(standardId, (pct) => {
        setProgress({ stage: "storing", percent: 60 + pct * 0.35, message: STAGE_LABELS.storing });
      });

      setProgress({ stage: "done", percent: 100, message: STAGE_LABELS.done });
      setResult(pollResult);
      queryClient.invalidateQueries({ queryKey: ["standards"] });
      await delay(500);
      setStep("success");
    } catch (e: any) {
      toast.error(e.message || "Processing failed");
      setStep("naming");
    }
  };

  const pollProcessing = async (
    standardId: string,
    onProgress: (fraction: number) => void
  ): Promise<{ totalChunks: number; indexedChunks: number; quality: number }> => {
    const maxAttempts = 100; // 5 min max

    for (let i = 0; i < maxAttempts; i++) {
      await delay(3000);

      // Check job status for accurate stage label
      const { data: job } = await (supabase as any)
        .from("processing_jobs")
        .select("status")
        .eq("standard_id", standardId)
        .single();

      if ((job as any)?.status === "pending") {
        setProgress(prev => ({ ...prev, stage: "extracting", message: "Queued — waiting to start…" }));
      } else if ((job as any)?.status === "processing") {
        setProgress(prev => ({ ...prev, stage: "storing", message: STAGE_LABELS.storing }));
      }

      const { data } = await supabase
        .from("standards")
        .select("extraction_status, total_chunks, indexed_chunks, extraction_quality_score")
        .eq("id", standardId)
        .single();

      if (!data) continue;

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

      // Estimate progress from indexed chunks
      if (data.total_chunks && data.total_chunks > 0) {
        onProgress((data.indexed_chunks || 0) / data.total_chunks);
      } else {
        onProgress(Math.min(i / 20, 0.8));
      }
    }

    throw new Error("Processing timed out. Check your standards library.");
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

        <div className="space-y-4 mb-8">
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

        <Button
          className="w-full h-12 font-bold rounded-xl gap-2"
          disabled={!docName.trim()}
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
    const stages = ["reading", "extracting", "sorting", "chunking", "storing", "done"];
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
          This may take a minute depending on document size.
        </p>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-3xl font-extrabold text-foreground">{result.totalChunks}</p>
                <p className="text-xs text-muted-foreground">Total Chunks</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-extrabold text-primary">{result.indexedChunks}</p>
                <p className="text-xs text-muted-foreground">Indexed Chunks</p>
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
