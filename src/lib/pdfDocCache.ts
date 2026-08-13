// Per-session cache of signed URLs and loaded pdf.js documents, keyed by
// standard.
//
// One answer routinely cites several tables from the same standard, and
// follow-up questions cite the same document again. Without this, each inline
// crop would mint its own signed URL and open its own copy of the PDF — on a
// 50MB standard over 4G that's the difference between one page fetch and a
// dozen document loads.
//
// In-flight PROMISES are cached (not resolved values) so images rendering in
// parallel in the same answer share a single load rather than racing.

import { supabase } from "@/integrations/supabase/client";

// fetch-pdf signs for 1 hour; expire early so a URL never dies mid-render.
const SIGNED_URL_TTL_MS = 50 * 60 * 1000;

interface UrlEntry {
  promise: Promise<string>;
  expiresAt: number;
}

const urlCache = new Map<string, UrlEntry>();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const docCache = new Map<string, Promise<any>>();

async function requestSignedUrl(standardId: string): Promise<string> {
  const { data, error } = await supabase.functions.invoke("fetch-pdf", {
    body: { standard_id: standardId },
  });
  if (error || !data?.signed_url) {
    throw new Error(error?.message || "Could not get PDF link");
  }
  return data.signed_url as string;
}

export function getSignedUrl(standardId: string): Promise<string> {
  const cached = urlCache.get(standardId);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = requestSignedUrl(standardId).catch((e) => {
    // Don't cache a failure — a transient network blip would otherwise poison
    // this standard's images for the rest of the session.
    urlCache.delete(standardId);
    throw e;
  });
  urlCache.set(standardId, { promise, expiresAt: Date.now() + SIGNED_URL_TTL_MS });
  return promise;
}

/**
 * Load (or reuse) the pdf.js document for a standard.
 * Callers must not destroy() the returned document — it is shared.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getPdfDoc(standardId: string): Promise<any> {
  const cached = docCache.get(standardId);
  if (cached) return cached;

  const promise = (async () => {
    const url = await getSignedUrl(standardId);
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

    // Same options as PDFViewerModal: range requests with autofetch off, so
    // showing one table pulls that page's bytes instead of the whole standard.
    return await pdfjsLib.getDocument({
      url,
      rangeChunkSize: 65536,
      disableAutoFetch: true,
      disableStream: true,
    }).promise;
  })().catch((e) => {
    docCache.delete(standardId);
    throw e;
  });

  docCache.set(standardId, promise);
  return promise;
}
