import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, Upload, Lock, Search, Loader2, Trash2, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { useStandards, useProfile, useProcessingJobs } from "@/hooks/useData";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";

const statusIcon = {
  pending: <Clock className="h-4 w-4 text-muted-foreground" />,
  processing: <Loader2 className="h-4 w-4 animate-spin text-primary" />,
  complete: <CheckCircle2 className="h-4 w-4 text-green-600" />,
  failed: <AlertCircle className="h-4 w-4 text-destructive" />,
};

const Standards = () => {
  const [searchQuery, setSearchQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const { user, session } = useAuth();
  const { data: standards = [], isLoading } = useStandards();
  const { data: profile } = useProfile();
  const { data: processingJobs = [] } = useProcessingJobs();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const tier = profile?.subscription_tier || "free";

  const filteredStandards = standards.filter(
    (s) =>
      s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (s.standard_code || "").toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleUpload = async () => {
    if (!session) {
      toast.error("Please sign in to upload standards");
      return;
    }

    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pdf";
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;

      if (file.type !== "application/pdf") {
        toast.error("Only PDF files are accepted");
        return;
      }

      if (file.size > 50 * 1024 * 1024) {
        toast.error("File must be under 50MB");
        return;
      }

      // Extract title from filename
      const title = file.name.replace(".pdf", "").replace(/[_-]/g, " ");

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("title", title);

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://wyxeqkgpwkcckyntqcns.supabase.co";
        const response = await fetch(
          `${supabaseUrl}/functions/v1/upload-standard`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
            body: formData,
          }
        );

        const text = await response.text();
        const data = text ? JSON.parse(text) : {};

        if (!response.ok) {
          if (data.upgrade_required) {
            toast.error(data.error);
          } else {
            toast.error(data.error || "Upload failed");
          }
          return;
        }

        toast.success("Standard uploaded! Processing will begin shortly.");
        queryClient.invalidateQueries({ queryKey: ["standards"] });

        // Poll for processing status
        const pollInterval = setInterval(async () => {
          const { data: updated } = await supabase
            .from("standards")
            .select("extraction_status")
            .eq("id", data.standard_id)
            .single();

          if (updated?.extraction_status === "complete") {
            clearInterval(pollInterval);
            toast.success("Standard processing complete!");
            queryClient.invalidateQueries({ queryKey: ["standards"] });
          } else if (updated?.extraction_status === "failed") {
            clearInterval(pollInterval);
            toast.error("Processing failed. Try a different PDF.");
            queryClient.invalidateQueries({ queryKey: ["standards"] });
          }
        }, 3000);

        // Stop polling after 5 minutes
        setTimeout(() => clearInterval(pollInterval), 300000);
      } catch (e: any) {
        toast.error(e.message || "Upload failed");
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const handleDelete = async (standardId: string) => {
    const { error } = await supabase.from("standards").delete().eq("id", standardId);
    if (error) {
      toast.error("Failed to delete standard");
    } else {
      toast.success("Standard deleted");
      queryClient.invalidateQueries({ queryKey: ["standards"] });
    }
  };

  return (
    <div className="px-5 py-6">
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
        <div className="space-y-3 mb-6">
          {filteredStandards.length === 0 && (
            <div className="text-center py-12">
              <BookOpen className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">
                {standards.length === 0
                  ? "No standards uploaded yet. Upload a PDF to get started."
                  : "No standards match your search."}
              </p>
            </div>
          )}

          {filteredStandards.map((s) => {
            const indexedPercent =
              s.total_chunks && s.total_chunks > 0
                ? Math.round(((s.indexed_chunks || 0) / s.total_chunks) * 100)
                : 0;

            return (
              <Card key={s.id} className="p-4">
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
                  const job = processingJobs.find(j => j.standard_id === s.id);
                  const queuePosition = processingJobs.filter(j => j.status === "pending").findIndex(j => j.standard_id === s.id);
                  const isProcessing = s.extraction_status === "processing" || job?.status === "processing";
                  const statusText = isProcessing
                    ? "Extracting & indexing content…"
                    : queuePosition >= 0
                    ? `Queued — position ${queuePosition + 1} in queue`
                    : "Queued — waiting to start…";

                  return (
                    <div className="mt-3 space-y-1.5">
                      <div className="h-1.5 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-primary animate-pulse"
                          style={{ width: isProcessing ? "60%" : "15%" }}
                        />
                      </div>
                      <p className="text-xs text-muted-foreground">{statusText}</p>
                    </div>
                  );
                })()}

                {s.extraction_status === "failed" && (
                  <div className="mt-3">
                    <Badge variant="destructive" className="text-xs">Extraction failed — try re-uploading</Badge>
                  </div>
                )}

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
                  </div>
                )}

                <div className="flex items-center justify-between mt-3">
                  <span className="text-xs text-muted-foreground">
                    {new Date(s.created_at).toLocaleDateString("en-AU", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(s.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

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
  );
};

export default Standards;
