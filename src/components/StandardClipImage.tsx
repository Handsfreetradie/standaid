import { useEffect, useRef, useState } from "react";
import { FileText, Image as ImageIcon, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { getPdfDoc } from "@/lib/pdfDocCache";
import {
  assemblePositionedLines,
  findLabelLine,
  computeCropRect,
  type PositionedItem,
} from "@/lib/pdf-text";

// Shows the actual table/diagram from the standard, cropped out of the PDF the
// user already owns and rendered live in the browser.
//
// Why render instead of storing an image: edge functions run Deno with no
// canvas, so there is no server-side rasteriser to crop with. Rendering here
// means no stored copies of copyrighted pages, no signed image URLs to expire
// inside cached team answers, no re-processing cost, and it works on every
// standard already in the library.
//
// Nothing is fetched until the user asks to see it: most citations in an
// answer are never opened, so eagerly pulling PDF bytes and rendering a crop
// for every single one wastes mobile data and clutters the chat. The initial
// state is a compact "View X" button; tapping it is what triggers the load.
//
// Degradation past that point is deliberate and three-tiered:
//   crop found      → show just the table/figure
//   label not found → show the whole page (still better than a text link)
//   anything throws → fall back to an "Open Table X" button (goes straight to
//                      the full PDF viewer, since the crop itself failed)

interface StandardClipImageProps {
  standardId: string;
  kind: "Figure" | "Table";
  refNumber: string;
  caption?: string;
  pageNumber: number;
  onOpenFull: () => void;
}

const MAX_WIDTH = 680;

export function StandardClipImage({
  standardId,
  kind,
  refNumber,
  caption,
  pageNumber,
  onOpenFull,
}: StandardClipImageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTaskRef = useRef<any>(null);
  const [status, setStatus] = useState<"collapsed" | "loading" | "ready" | "failed">("collapsed");
  // Bumped on unmount and whenever the citation identity changes, so a stale
  // in-flight load from a previous tap/identity can never land after the fact.
  const generationRef = useRef(0);

  // If the citation this instance points at changes (a different
  // standard/kind/ref/page), drop back to collapsed rather than showing a
  // crop that no longer matches the caption above it.
  useEffect(() => {
    generationRef.current++;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    setStatus("collapsed");
  }, [standardId, kind, refNumber, pageNumber]);

  useEffect(() => {
    return () => {
      generationRef.current++;
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, []);

  const load = async () => {
    if (status !== "collapsed") return;
    const myGeneration = generationRef.current;
    const stale = () => myGeneration !== generationRef.current;

    setStatus("loading");
    try {
      const doc = await getPdfDoc(standardId);
      if (stale()) return;

      const pageIndex = Math.min(Math.max(pageNumber, 1), doc.numPages);
      const page = await doc.getPage(pageIndex);
      if (stale()) return;

      const baseViewport = page.getViewport({ scale: 1 });

      // Locate the caption to crop to. Reuses the same line assembly the
      // extraction pipeline uses, so what we crop to matches what was indexed.
      const content = await page.getTextContent();
      if (stale()) return;

      const items: PositionedItem[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str) continue;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const t = (it as any).transform;
        items.push({
          str: it.str,
          x: t[4],
          y: t[5],
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          w: (it as any).width ?? 0,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          h: (it as any).height || Math.hypot(t[2], t[3]) || 10,
        });
      }

      const lines = assemblePositionedLines(items);
      const labelIndex = findLabelLine(lines, kind, refNumber);
      const crop =
        labelIndex === -1
          ? null
          : computeCropRect(lines, labelIndex, baseViewport.width, baseViewport.height);

      // Wait for the canvas: it only mounts once status flips off "loading".
      setStatus("ready");
      await new Promise((r) => requestAnimationFrame(r));
      if (stale()) return;

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      // Crop rect is in PDF user space (origin bottom-left); the viewport
      // converts it to device space (origin top-left) for us.
      const regionWidth = crop ? crop.x1 - crop.x0 : baseViewport.width;
      const displayWidth = Math.min(window.innerWidth - 32, MAX_WIDTH);
      const scale = displayWidth / regionWidth;
      const viewport = page.getViewport({ scale });

      let offsetX = 0;
      let offsetY = 0;
      let cssHeight = viewport.height;
      if (crop) {
        const [vx0, vy0, vx1, vy1] = viewport.convertToViewportRectangle([
          crop.x0,
          crop.y0,
          crop.x1,
          crop.y1,
        ]);
        offsetX = Math.min(vx0, vx1);
        offsetY = Math.min(vy0, vy1);
        cssHeight = Math.abs(vy1 - vy0);
      }

      // Set only the BACKING resolution here, never an explicit CSS size:
      // the canvas is laid out by `w-full h-auto`, which scales it to
      // whatever the chat bubble is and preserves the aspect ratio from
      // these width/height attributes. An inline style.width beats the
      // `w-full` class, so pinning it to displayWidth overflowed and clipped
      // the right-hand columns off any bubble narrower than 680px.
      // Rendering above the display size also keeps fine print sharp.
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(displayWidth * dpr);
      canvas.height = Math.ceil(cssHeight * dpr);

      // Shift the page so the crop's top-left lands at the canvas origin —
      // this is what makes pdf.js draw only the region we want.
      const task = page.render({
        canvasContext: ctx,
        viewport,
        transform: [dpr, 0, 0, dpr, -offsetX * dpr, -offsetY * dpr],
      });
      renderTaskRef.current = task;
      await task.promise;
    } catch (e) {
      // RenderingCancelledException is the expected result of the identity
      // changing or the component unmounting mid-render.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      if ((e as any)?.name === "RenderingCancelledException") return;
      if (!stale()) {
        console.error(`[StandardClipImage] ${kind} ${refNumber}:`, e);
        setStatus("failed");
      }
    }
  };

  // Collapses back to the "View X" prompt — from mid-load (cancels the
  // pending render) or from an already-shown image (the user just wants it
  // out of the way, without needing to leave the chat to do it).
  const close = () => {
    generationRef.current++;
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }
    setStatus("collapsed");
  };

  const label = `${kind} ${refNumber}${caption ? ` — ${caption}` : ""}`;

  if (status === "collapsed") {
    return (
      <button
        onClick={load}
        className="flex items-center gap-2 w-full text-left rounded-lg border border-border px-3 py-2.5 text-xs text-primary hover:bg-primary/5 active:scale-[0.99] transition-all"
      >
        <ImageIcon className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 font-medium">View {label}</span>
        <span className="text-muted-foreground text-[10px]">p.{pageNumber}</span>
      </button>
    );
  }

  if (status === "failed") {
    return (
      <button
        onClick={onOpenFull}
        className="flex items-center gap-2 w-full text-left rounded-lg border border-border px-3 py-2.5 text-xs text-primary hover:bg-primary/5 active:scale-[0.99] transition-all"
      >
        <FileText className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 font-medium">Open {label}</span>
        <span className="text-muted-foreground text-[10px]">p.{pageNumber}</span>
      </button>
    );
  }

  return (
    <div className="rounded-lg overflow-hidden border border-border">
      {status === "loading" ? (
        <Skeleton className="w-full h-40" />
      ) : (
        <button
          onClick={onOpenFull}
          className="block w-full active:scale-[0.99] transition-transform"
          aria-label={`Open ${label} in the full standard`}
        >
          <canvas ref={canvasRef} className="w-full h-auto block bg-white" />
        </button>
      )}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-muted/30">
        <p className="flex-1 text-[10px] text-muted-foreground">
          {label} · p.{pageNumber} — tap to open
        </p>
        <button
          onClick={close}
          aria-label={`Hide ${label}`}
          className="flex-shrink-0 -m-1 p-1 text-muted-foreground hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
