import { useState, useCallback, useRef } from "react";
import { FileText, Search, Loader2, CheckCircle, AlertTriangle, Upload, ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Section {
  heading: string;
  text: string;
}

interface Chunk {
  label: string;
  text: string;
  section: string;
}

type Step = "upload" | "sections" | "chunks" | "query";

const SECTION_REGEX = /^(Section\s+\d+[\.\d]*|^\d+[\.\d]*\s*[–—-]?\s*[A-Z]|\b(?:PART|CLAUSE|APPENDIX)\s+[A-Z\d]+)/im;

function parseSections(rawText: string): Section[] {
  const lines = rawText.split("\n");
  const sections: Section[] = [];
  let currentHeading = "Preamble";
  let currentLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    // Match section-like headings
    const match = trimmed.match(/^(Section\s+\d+[\.\d]*[\s:–—-]*.*)$/i)
      || trimmed.match(/^(\d+[\.\d]*\s+[A-Z].{2,})$/)
      || trimmed.match(/^(PART\s+[A-Z\d]+[\s:–—-]*.*)$/i)
      || trimmed.match(/^(CLAUSE\s+\d+[\.\d]*[\s:–—-]*.*)$/i)
      || trimmed.match(/^(APPENDIX\s+[A-Z\d]+[\s:–—-]*.*)$/i);

    if (match && currentLines.length > 0) {
      sections.push({ heading: currentHeading, text: currentLines.join("\n").trim() });
      currentHeading = match[1].trim();
      currentLines = [];
    } else if (match && currentLines.length === 0) {
      currentHeading = match[1].trim();
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({ heading: currentHeading, text: currentLines.join("\n").trim() });
  }

  return sections.filter(s => s.text.length > 20);
}

const ChunkTest = () => {
  const [step, setStep] = useState<Step>("upload");
  const [rawText, setRawText] = useState("");
  const [docName, setDocName] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [chunks, setChunks] = useState<Chunk[]>([]);
  const [chunkingProgress, setChunkingProgress] = useState(0);
  const [isChunking, setIsChunking] = useState(false);
  const [question, setQuestion] = useState("");
  const [isQuerying, setIsQuerying] = useState(false);
  const [queryResult, setQueryResult] = useState<{ answer: string; chunks_used: string[] } | null>(null);
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocName(file.name);

    if (file.type === "text/plain" || file.name.endsWith(".txt") || file.name.endsWith(".md")) {
      const text = await file.text();
      setRawText(text);
      toast.success(`Loaded ${file.name}`);
    } else {
      toast.error("For this test, please use a .txt or .md file with your standard's text content.");
      return;
    }
  }, []);

  const handleParseSections = useCallback(() => {
    if (!rawText.trim()) {
      toast.error("No text to parse");
      return;
    }
    const parsed = parseSections(rawText);
    setSections(parsed);
    setStep("sections");
    toast.success(`Found ${parsed.length} sections`);
  }, [rawText]);

  const handleChunkAll = useCallback(async () => {
    if (sections.length === 0) return;
    setIsChunking(true);
    setChunkingProgress(0);
    const allChunks: Chunk[] = [];

    for (let i = 0; i < sections.length; i++) {
      const section = sections[i];
      setChunkingProgress(Math.round(((i) / sections.length) * 100));

      try {
        const { data, error } = await supabase.functions.invoke("chunk-test", {
          body: { section_heading: section.heading, section_text: section.text },
        });

        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        const sectionChunks = (data?.chunks || []).map((c: any) => ({
          label: c.label,
          text: c.text,
          section: data.section || section.heading,
        }));
        allChunks.push(...sectionChunks);
      } catch (err: any) {
        console.error(`Chunking failed for section "${section.heading}":`, err);
        toast.error(`Failed to chunk: ${section.heading}`);
        // Still continue with other sections
        allChunks.push({
          label: `${section.heading} (raw)`,
          text: section.text.slice(0, 2000),
          section: section.heading,
        });
      }
    }

    setChunks(allChunks);
    setChunkingProgress(100);
    setIsChunking(false);
    setStep("chunks");
    toast.success(`Created ${allChunks.length} chunks from ${sections.length} sections`);
  }, [sections]);

  const handleQuery = useCallback(async () => {
    if (!question.trim() || chunks.length === 0) return;
    setIsQuerying(true);
    setQueryResult(null);

    // Local keyword matching to find relevant chunks
    const keywords = question.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const scored = chunks.map((chunk) => {
      const lower = (chunk.text + " " + chunk.label).toLowerCase();
      const score = keywords.reduce((acc, kw) => acc + (lower.includes(kw) ? 1 : 0), 0);
      return { chunk, score };
    });
    scored.sort((a, b) => b.score - a.score);
    const relevant = scored.filter(s => s.score > 0).slice(0, 5);

    if (relevant.length === 0) {
      setQueryResult({ answer: "No relevant chunks found for this question via keyword match.", chunks_used: [] });
      setIsQuerying(false);
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke("query-test", {
        body: {
          question: question.trim(),
          chunks: relevant.map(r => ({ label: r.chunk.label, text: r.chunk.text })),
        },
      });

      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);

      setQueryResult({
        answer: data.answer || "No answer returned.",
        chunks_used: data.chunks_used || relevant.map(r => r.chunk.label),
      });
    } catch (err: any) {
      console.error("Query test error:", err);
      toast.error(err.message || "Query failed");
    } finally {
      setIsQuerying(false);
    }
  }, [question, chunks]);

  const toggleSection = (idx: number) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  return (
    <div className="px-4 py-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">Chunk & Query Test</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Test section sorting, AI chunking, and reference accuracy
        </p>
      </div>

      {/* Progress Steps */}
      <div className="flex items-center gap-2 text-xs font-medium">
        {(["upload", "sections", "chunks", "query"] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-1">
            <Badge variant={step === s ? "default" : sections.length > 0 && i <= ["upload","sections","chunks","query"].indexOf(step) ? "secondary" : "outline"} className="text-xs capitalize">
              {i + 1}. {s}
            </Badge>
            {i < 3 && <span className="text-muted-foreground">→</span>}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Upload className="h-4 w-4" /> 1. Upload Document
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md"
            onChange={handleFileUpload}
            className="hidden"
          />
          <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
            Choose .txt / .md file
          </Button>
          {docName && <p className="text-xs text-muted-foreground">Loaded: {docName}</p>}

          <p className="text-xs text-muted-foreground">Or paste text directly:</p>
          <Textarea
            value={rawText}
            onChange={e => setRawText(e.target.value)}
            placeholder="Paste standard text here..."
            className="min-h-[120px] text-xs font-mono"
          />
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleParseSections} disabled={!rawText.trim()}>
              Parse Sections
            </Button>
            {rawText && <span className="text-xs text-muted-foreground">{rawText.length.toLocaleString()} chars</span>}
          </div>
        </CardContent>
      </Card>

      {/* Step 2: Sections */}
      {sections.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <FileText className="h-4 w-4" /> 2. Sections Found ({sections.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <ScrollArea className="max-h-[300px]">
              {sections.map((sec, i) => (
                <div key={i} className="border-b border-border last:border-0 py-2">
                  <button
                    onClick={() => toggleSection(i)}
                    className="flex items-center gap-2 w-full text-left"
                  >
                    {expandedSections.has(i) ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <span className="text-sm font-medium text-foreground">{sec.heading}</span>
                    <span className="text-xs text-muted-foreground ml-auto">{sec.text.length} chars</span>
                  </button>
                  {expandedSections.has(i) && (
                    <p className="text-xs text-muted-foreground mt-1 pl-5 line-clamp-4 font-mono">
                      {sec.text.slice(0, 500)}{sec.text.length > 500 ? "..." : ""}
                    </p>
                  )}
                </div>
              ))}
            </ScrollArea>
            <Button size="sm" onClick={handleChunkAll} disabled={isChunking}>
              {isChunking ? (
                <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Chunking ({chunkingProgress}%)</>
              ) : (
                "Chunk All Sections via AI"
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Chunks */}
      {chunks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <CheckCircle className="h-4 w-4 text-green-600" /> 3. Chunks ({chunks.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="max-h-[300px]">
              <div className="space-y-2">
                {chunks.map((chunk, i) => (
                  <div key={i} className="rounded-md border border-border p-3">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="secondary" className="text-xs">{chunk.section}</Badge>
                      <span className="text-xs font-medium text-foreground">{chunk.label}</span>
                    </div>
                    <p className="text-xs text-muted-foreground font-mono line-clamp-3">{chunk.text}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
            <Button size="sm" className="mt-3" onClick={() => setStep("query")}>
              Proceed to Query Test
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Query */}
      {step === "query" && chunks.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Search className="h-4 w-4" /> 4. Query Test
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Ask a question about the standard..."
              onKeyDown={e => e.key === "Enter" && handleQuery()}
            />
            <Button size="sm" onClick={handleQuery} disabled={isQuerying || !question.trim()}>
              {isQuerying ? <><Loader2 className="h-3 w-3 animate-spin mr-1" /> Querying...</> : "Ask AI"}
            </Button>

            {queryResult && (
              <div className="space-y-3 mt-4">
                <div className="rounded-lg bg-muted p-4">
                  <p className="text-sm font-medium text-foreground mb-2">Answer:</p>
                  <p className="text-sm text-foreground whitespace-pre-wrap">{queryResult.answer}</p>
                </div>
                {queryResult.chunks_used.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-muted-foreground mb-1">Source chunks used:</p>
                    <div className="flex flex-wrap gap-1">
                      {queryResult.chunks_used.map((label, i) => (
                        <Badge key={i} variant="outline" className="text-xs">{label}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ChunkTest;
