import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Upload, Lock, Search, Loader2, Trash2, CheckCircle2, AlertCircle, Clock, FileText } from "lucide-react";
import { PDFViewerModal } from "@/components/PDFViewerModal";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useStandards, useProfile, useProcessingJobs } from "@/hooks/useData";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const statusIcon = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  processing: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  complete: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  failed: <AlertCircle className="h-4 w-4 text-destructive" />,
  ai_disabled: <Lock className="h-4 w-4 text-muted-foreground" />,
};

// "TABLE 5.1" -> "Table 5.1" — the raw clause_number as stored, not meant for
// display as-is.
function titleCaseLabel(label: string): string {
  return label.replace(/^(TABLE|FIGURE)\b/i, (m) => m[0].toUpperCase() + m.slice(1).toLowerCase());
}

// Names the specific figures/tables that permanently failed, rather than a
// bare count that gives the reader no way to judge if it matters to them.
// Falls back to the count alone for any standard whose labels haven't been
// backfilled/recomputed yet (labels array empty but count > 0).
export function formatFailedLabels(labels: string[] | null | undefined, count: number): string {
  const list = (labels || []).filter(Boolean);
  if (list.length === 0) {
    return `${count} figure${count === 1 ? "" : "s"}/table${count === 1 ? "" : "s"}`;
  }
  const shown = list.slice(0, 3).map(titleCaseLabel);
  const extra = list.length - shown.length;
  return extra > 0 ? `${shown.join(", ")} and ${extra} more` : shown.join(", ");
}

const Standards = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [pdfViewer, setPdfViewer] = useState<{ standardId: string; standardCode: string } | null>(null);
  const { data: standards = [], isLoading } = useStandards();
  const { data: profile } = useProfile();
  const { data: processingJobs = [] } = useProcessingJobs();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const tier = profile?.subscription_tier; // undefined while loading — never guess

  const filteredStandards = standards.filter(
    (s) =>
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.standard_code || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = async (standardId: string) => {
    if (!window.confirm("Delete this standard? This cannot be undone.")) return;

    // Collect storage paths BEFORE deleting the row — the figure rows
    // cascade-delete with it, after which the paths are unrecoverable.
    // Previously only the DB row was removed and the 20-50MB PDF plus every
    // figure image stayed in storage forever.
    const standard = standards.find((s) => s.id === standardId);
    const { data: { user } } = await supabase.auth.getUser();

    const { error } = await supabase.from("standards").delete().eq("id", standardId);
    if (error) {
      toast.error("Failed to delete standard");
      return;
    }

    try {
      const filePath = (standard as any)?.file_path as string | undefined;
      if (filePath) {
        await supabase.storage.from("standards").remove([filePath, filePath.replace(/\.pdf$/i, ".txt")]);
      }
      if (user) {
        const figureFolder = `${user.id}/${standardId}`;
        const { data: figureFiles } = await supabase.storage.from("standard-figures").list(figureFolder);
        if (figureFiles && figureFiles.length > 0) {
          await supabase.storage.from("standard-figures").remove(
            figureFiles.map((f) => `${figureFolder}/${f.name}`),
          );
        }
      }
    } catch (e) {
      console.warn("Storage cleanup after delete failed (non-fatal):", e);
    }

    toast.success("Standard deleted");
    queryClient.invalidateQueries({ queryKey: ["standards"] });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="px-5 py-6 pb-24 md:pb-8 max-w-5xl md:mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-sans text-2xl font-extrabold tracking-tight text-foreground">
            Standards Library
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {standards.length} standard{standards.length !== 1 ? "s" : ""} uploaded
            {tier === "free" && " (Free tier: 1 max)"}
          </p>
        </div>
        <Button
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => navigate("/standards/upload")}
        >
          <Upload className="h-4 w-4" />
          Upload
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search standards..."
          className="pl-9 h-11"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Standards List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        filteredStandards.length === 0 ? (
          <div className="text-center py-12 mb-6">
            <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">
              {standards.length === 0
                ? "No standards uploaded yet. Upload a PDF to get started."
                : "No standards match your search."}
            </p>
          </div>
        ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 mb-6">
          {filteredStandards.map((s) => {
            const indexedPercent =
              s.total_chunks && s.total_chunks > 0
                ? Math.round(((s.indexed_chunks || 0) / s.total_chunks) * 100)
                : 0;

            return (
              <Card key={s.id} className="p-4 flex flex-col h-full">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-bold text-foreground">
                        {s.standard_code || s.title}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {s.standard_code ? s.title : s.version || ""}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s.organization_id && s.user_id !== user?.id && (
                      <Badge variant="outline" className="text-xs">Shared by teammate</Badge>
                    )}
                    {s.trade_category && (
                      <Badge variant="secondary" className="text-xs">
                        {s.trade_category}
                      </Badge>
                    )}
                    {statusIcon[s.extraction_status as keyof typeof statusIcon]}
                  </div>
                </div>

                {/* Progress section */}
                {(s.extraction_status === "pending" || s.extraction_status === "processing") && (() => {
                  const job = processingJobs.find((j: any) => j.standard_id === s.id);
                  const queuePosition = processingJobs.filter((j: any) => j.status === "pending").findIndex((j: any) => j.standard_id === s.id);
                  const isProcessing = s.extraction_status === "processing" || (job as any)?.status === "processing";
                  const isIndexing = isProcessing && (s.total_chunks ?? 0) > 0;
                  const statusText = isIndexing
                    ? "Indexing content…"
                    : isProcessing
                    ? "Extracting content…"
                    : queuePosition >= 0
                    ? `Queued — position ${queuePosition + 1} in queue`
                    : "Queued — waiting to start…";
                  const barWidth = isIndexing ? "80%" : isProcessing ? "40%" : "15%";

                  return (
                    <div className="mt-3 space-y-1.5">
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary animate-pulse"
                          style={{ width: barWidth }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{statusText}</p>
                    </div>
                  );
                })()}

                {s.extraction_status === "ai_disabled" && (
                  <div className="mt-3">
                    <p className="text-xs text-muted-foreground flex items-start gap-1.5">
                      <Lock className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                      Stored for reference only — AI search unavailable under the publisher's licensing terms.
                    </p>
                  </div>
                )}

                {s.extraction_status === "failed" && (() => {
                  const failedJob = processingJobs.find((j: any) => j.standard_id === s.id);
                  return (
                    <div className="mt-3 space-y-1.5">
                      <Badge variant="destructive" className="text-xs">Extraction failed</Badge>
                      <p className="text-xs text-muted-foreground">
                        {(failedJob as any)?.error_message ||
                          "Something went wrong reading this PDF. Deleting this entry and re-uploading may help."}
                      </p>
                    </div>
                  );
                })()}

                {s.extraction_status === "complete" && (
                  <div className="mt-3 space-y-1.5">
                    <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${indexedPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">
                        {(s.indexed_chunks || 0)} / {(s.total_chunks || 0)} chunks indexed ({indexedPercent}%)
                      </span>
                      <div className="flex items-center gap-2">
                        {s.extraction_quality_score != null && (
                          <Badge variant={s.extraction_quality_score >= 70 ? "secondary" : "destructive"} className="text-xs">
                            {Math.round(s.extraction_quality_score)}% quality
                          </Badge>
                        )}
                        {(s.indexed_chunks || 0) === 0 && (
                          <Badge variant="destructive" className="text-xs">No content</Badge>
                        )}
                      </div>
                    </div>
                    {(s.failed_chunks_count || 0) > 0 && (
                      <p className="text-xs text-amber-600 dark:text-amber-500 flex items-center gap-1">
                        <AlertCircle className="h-3.5 w-3.5 flex-shrink-0" />
                        {formatFailedLabels(s.failed_chunks_labels, s.failed_chunks_count)} couldn't
                        be processed — the rest of the document is fully searchable.
                      </p>
                    )}
                  </div>
                )}

                <div className="flex items-center justify-between mt-auto pt-3">
                  <span className="text-xs text-muted-foreground">
                    {new Date(s.created_at).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <div className="flex items-center gap-1">
                    {(s.extraction_status === "complete" || s.extraction_status === "ai_disabled") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setPdfViewer({ standardId: s.id, standardCode: s.standard_code || s.title })}
                      >
                        <FileText className="h-4 w-4" />
                        View PDF
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(s.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
        )
      )}

      <PDFViewerModal
        isOpen={!!pdfViewer}
        onClose={() => setPdfViewer(null)}
        clauseNumber=""
        standardId={pdfViewer?.standardId}
        standardCode={pdfViewer?.standardCode}
      />

      {/* Upgrade CTA for free tier */}
      {tier === "free" && (
        <Card className="border-primary/20 bg-primary/5 p-4">
          <div className="flex items-start gap-3">
            <Lock className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                Unlock full indexing
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Your standards are only 25% indexed on the Free tier. Upgrade to
                Pro for full document access and unlimited uploads.
              </p>
              <Button size="sm" className="mt-3 h-9 text-xs font-semibold">
                Upgrade to Pro
              </Button>
            </div>
          </div>
        </Card>
      )}
      </div>
    </div>
  );
};

export default Standards;
