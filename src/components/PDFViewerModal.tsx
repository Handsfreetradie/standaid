import { useEffect, useRef, useState } from "react";
import { X, ChevronLeft, ChevronRight, Loader2, AlertTriangle, FileText, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";

interface PDFViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  clauseNumber: string;
  standardCode?: string;
  standardId?: string;
  pageNumber?: number;
}

interface PDFMeta {
  signed_url: string;
  page_number: number;
  clause_title: string | null;
  standard_title: string | null;
  standard_code: string | null;
  standard_id: string | null;
}

export function PDFViewerModal({ isOpen, onClose, clauseNumber, standardCode, standardId, pageNumber }: PDFViewerModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [meta, setMeta] = useState<PDFMeta | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const renderTaskRef = useRef<any>(null);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setMeta(null);
    setPdfDoc(null);
    setSearchQuery("");
    setSearchError(null);

    supabase.functions.invoke("fetch-pdf", {
      body: { standard_id: standardId, standard_code: standardCode, clause_number: clauseNumber, page_number: pageNumber },
    }).then(({ data, error: fnError }) => {
      if (fnError || !data?.signed_url) {
        setError("Could not load PDF. Please try again.");
        setLoading(false);
        return;
      }
      setMeta(data);
      setCurrentPage(data.page_number ?? 1);
      loadPdf(data.signed_url, data.page_number ?? 1);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, clauseNumber, standardCode, standardId, pageNumber]);

  const loadPdf = async (url: string, startPage: number) => {
    try {
      const pdfjsLib = await import("pdfjs-dist");
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

      const doc = await pdfjsLib.getDocument({ url, rangeChunkSize: 65536 }).promise;
      setPdfDoc(doc);
      setTotalPages(doc.numPages);
      await renderPage(doc, startPage);
    } catch (e) {
      console.error("[PDFViewerModal] load error:", e);
      setError("Failed to load PDF.");
    } finally {
      setLoading(false);
    }
  };

  const renderPage = async (doc: any, pageNum: number) => {
    if (!canvasRef.current) return;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    const page = await doc.getPage(pageNum);
    const canvas = canvasRef.current;
    const context = canvas.getContext("2d");
    if (!context) return;

    const containerWidth = Math.min(window.innerWidth - 32, 680);
    const viewport = page.getViewport({ scale: 1 });
    const scale = containerWidth / viewport.width;
    const scaled = page.getViewport({ scale });

    canvas.width = scaled.width;
    canvas.height = scaled.height;

    const task = page.render({ canvasContext: context, viewport: scaled });
    renderTaskRef.current = task;
    try {
      await task.promise;
      contentRef.current?.scrollTo({ top: 0 });
    } catch (e: any) {
      if (e?.name !== "RenderingCancelledException") console.error("[PDFViewerModal] render error:", e);
    }
  };

  const goToPage = async (pageNum: number) => {
    if (!pdfDoc || pageNum < 1 || pageNum > totalPages) return;
    setCurrentPage(pageNum);
    await renderPage(pdfDoc, pageNum);
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q || !pdfDoc) return;

    // Pure number → jump to page
    const pageNum = parseInt(q, 10);
    if (!isNaN(pageNum) && String(pageNum) === q) {
      setSearchError(null);
      goToPage(pageNum);
      return;
    }

    // Clause number search via standard_chunks
    const sid = meta?.standard_id ?? standardId;
    if (!sid) {
      setSearchError("Can't search by clause — standard not identified.");
      return;
    }

    setSearching(true);
    setSearchError(null);
    try {
      const { data } = await supabase
        .from("standard_chunks")
        .select("page_number")
        .eq("standard_id", sid)
        .ilike("clause_number", `${q}%`)
        .order("chunk_index", { ascending: true })
        .limit(1)
        .single();

      if (data?.page_number) {
        goToPage(data.page_number);
      } else {
        setSearchError(`No clause found for "${q}"`);
      }
    } finally {
      setSearching(false);
    }
  };

  if (!isOpen) return null;

  const resolvedStandardCode = meta?.standard_code ?? standardCode ?? "Standard";
  const clauseLabel = clauseNumber
    ? /^\d/.test(clauseNumber) ? `Clause ${clauseNumber}` : clauseNumber
    : pageNumber ? `Page ${pageNumber}` : null;
  const title = clauseLabel ? `${resolvedStandardCode} — ${clauseLabel}` : resolvedStandardCode;

  return (
    <>
      {/* Backdrop — full viewport, closes modal on click */}
      <div className="fixed inset-0 z-[60] bg-black/60" onClick={onClose} />

      {/* Modal container — sits above bottom nav, stops backdrop clicks via stopPropagation */}
      <div
        className="fixed inset-x-0 top-0 z-[61] flex items-end justify-center sm:items-center"
        style={{ bottom: `calc(4rem + env(safe-area-inset-bottom, 0px))` }}
        onClick={onClose}
      >
        <div
          className="flex flex-col bg-card rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-full shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border flex-shrink-0">
            <FileText className="h-4 w-4 text-primary flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground truncate">{title}</p>
              {meta?.clause_title && (
                <p className="text-xs text-muted-foreground truncate">{meta.clause_title}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="flex-shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* Search bar */}
          {!loading && !error && (
            <form onSubmit={handleSearch} className="flex items-center gap-2 px-4 py-2 border-b border-border flex-shrink-0 bg-muted/20">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(e) => { setSearchQuery(e.target.value); setSearchError(null); }}
                  placeholder="Clause (e.g. 3.6.2) or page number…"
                  className="pl-8 h-8 text-xs"
                />
              </div>
              <Button type="submit" size="sm" variant="outline" className="h-8 px-3 text-xs flex-shrink-0" disabled={searching}>
                {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Go"}
              </Button>
            </form>
          )}
          {searchError && (
            <p className="px-4 py-1 text-xs text-destructive bg-destructive/5 flex-shrink-0">{searchError}</p>
          )}

          {/* Scrollable content — min-h-0 is required for flex+max-height to work */}
          <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto bg-muted/30">
            {loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 className="h-7 w-7 text-primary animate-spin" />
                <p className="text-sm text-muted-foreground">Loading standard…</p>
              </div>
            )}
            {error && !loading && (
              <div className="flex flex-col items-center justify-center py-16 gap-3 px-6 text-center">
                <AlertTriangle className="h-7 w-7 text-destructive" />
                <p className="text-sm text-destructive">{error}</p>
              </div>
            )}
            {!loading && !error && (
              <div className="flex justify-center p-2">
                <canvas ref={canvasRef} className="max-w-full shadow-sm rounded" />
              </div>
            )}
          </div>

          {/* Page navigation */}
          {!loading && !error && totalPages > 0 && (
            <div
              className="flex items-center justify-between px-4 py-3 border-t border-border flex-shrink-0 bg-card"
              style={{ paddingBottom: `max(12px, env(safe-area-inset-bottom, 12px))` }}
            >
              <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)} className="gap-1">
                <ChevronLeft className="h-4 w-4" />
                Prev
              </Button>
              <span className="text-xs text-muted-foreground">Page {currentPage} of {totalPages}</span>
              <Button variant="outline" size="sm" disabled={currentPage >= totalPages} onClick={() => goToPage(currentPage + 1)} className="gap-1">
                Next
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
