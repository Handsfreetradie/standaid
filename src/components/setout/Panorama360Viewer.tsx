import { useEffect, useRef } from "react";

interface Panorama360ViewerProps {
  imageUrl: string;
}

// Pannellum (an equirectangular panorama viewer) is loaded on demand, not
// statically imported — it's only ever needed when an actual 360 photo
// point is open, and its build brings its own CSS plus a WebGL renderer
// that most sessions never touch. Same dynamic-import convention already
// used for svg2pdf.js/qrcode elsewhere in this app.
export default function Panorama360Viewer({ imageUrl }: Panorama360ViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    (async () => {
      await import("pannellum/build/pannellum.css");
      await import("pannellum/build/pannellum.js");
      if (cancelled || !container) return;
      const pannellum = (window as unknown as { pannellum: { viewer: (el: HTMLElement, config: Record<string, unknown>) => { destroy: () => void } } }).pannellum;
      viewerRef.current = pannellum.viewer(container, {
        type: "equirectangular",
        panorama: imageUrl,
        autoLoad: true,
        showControls: true,
        compass: false,
      });
    })();

    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
    };
  }, [imageUrl]);

  return <div ref={containerRef} className="w-full h-full" />;
}
