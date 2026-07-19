// Mirrors the server's scanned-document heuristics in process-standard:
// a page with fewer than SCANNED_PAGE_THRESHOLD extractable characters is
// treated as a scan (an image, not text), and a document where more than
// SCANNED_DOC_RATIO of pages are scans needs AI OCR — which the server
// refuses above AI_OCR_FILE_LIMIT bytes. Checking this client-side, after
// PDF.js extraction but before anything is uploaded, lets us tell the user
// immediately instead of after a doomed round-trip through the pipeline.
export const SCANNED_PAGE_THRESHOLD = 15;
export const SCANNED_DOC_RATIO = 0.85;
export const AI_OCR_FILE_LIMIT = 10 * 1024 * 1024;

// extractedText is the client extraction output with [PAGE N] markers.
// Returns true only when BOTH conditions hold — the document reads as a scan
// AND the file is too big for server-side OCR. An empty string (extraction
// failed outright) returns false: that can be DRM rather than a scan, and the
// server has better tools to decide.
export function scanTooLargeForOcr(extractedText: string, fileSizeBytes: number): boolean {
  if (fileSizeBytes <= AI_OCR_FILE_LIMIT) return false;
  if (!extractedText) return false;

  const pages = extractedText.split(/\[PAGE \d+\]\n?/).slice(1);
  if (pages.length === 0) return false;

  const scannedPages = pages.filter((p) => p.trim().length < SCANNED_PAGE_THRESHOLD).length;
  return scannedPages / pages.length > SCANNED_DOC_RATIO;
}
