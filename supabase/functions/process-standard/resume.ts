// Pure checkpoint-application logic for multi-window OCR resume, split out
// so it can be unit-tested directly: ocr.ts pulls in esm.sh deps vitest can't
// resolve, and index.ts (either function) calls serve() at module load.
// No imports — keep it that way.

export interface OcrCheckpointRow {
  ocr_text: string | null;
  ocr_next_page: number | null;
}

export interface OcrResumeState {
  priorText: string;
  startPage: number;
}

// ocr_next_page <= 1 means "nothing transcribed yet" — a fresh job row, or
// one that was never checkpointed. Both cases start OCR from page 1, i.e.
// no resume state.
export function buildOcrResume(job: OcrCheckpointRow | null | undefined): OcrResumeState | undefined {
  if (!job?.ocr_next_page || job.ocr_next_page <= 1) return undefined;
  return { priorText: job.ocr_text || "", startPage: job.ocr_next_page };
}

// True when a resumed OCR window made zero forward progress past the page it
// resumed from — retriggering again would loop forever burning API spend.
export function isStalledResume(resume: OcrResumeState | undefined, nextPage: number): boolean {
  return resume !== undefined && nextPage <= resume.startPage;
}
