// Builds the Site Audit PDF report. Pure function — takes plain data (no
// React/DB/Supabase calls) so the caller decides how to fetch/encode images.
import jsPDF from "jspdf";
import {
  summariseAudit, sortForReport, SEVERITY_META, type AuditPhoto,
} from "@/lib/audit";

export interface ReportPhoto extends AuditPhoto {
  imageBase64?: string | null; // data URL, e.g. "data:image/jpeg;base64,..."
}

export interface ReportAudit {
  title: string;
  site_address?: string | null;
  trade?: string | null;
  signed_off_by?: string | null;
  signed_off_licence?: string | null;
  signed_off_at?: string | null;
}

export interface ReportBusiness {
  name?: string | null;
  licenceNumber?: string | null;
  logoBase64?: string | null; // data URL
}

const TRADE_LABELS: Record<string, string> = {
  electrical: "Electrical",
  plumbing: "Plumbing",
  building: "Building & Construction",
  carpentry: "Carpentry",
  gas: "Gas Fitting",
  hvac: "HVAC",
  health_safety: "Health & Safety",
  engineering: "Engineering",
  food_safety: "Food Safety",
  other: "Other",
};

const PAGE_W = 210; // A4 mm
const PAGE_H = 297;
const MARGIN = 15;
const CONTENT_W = PAGE_W - MARGIN * 2;

// Only used to size an embedded image without distorting it (jsPDF needs
// explicit dimensions and can't measure the source itself).
function loadImageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth || 1, h: img.naturalHeight || 1 });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

export async function generateAuditReportPdf(opts: {
  audit: ReportAudit;
  photos: ReportPhoto[];
  business: ReportBusiness;
}): Promise<jsPDF> {
  const { audit, business } = opts;
  const photos = sortForReport(opts.photos) as ReportPhoto[];
  const summary = summariseAudit(photos);

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  let y = MARGIN;

  const ensureSpace = (needed: number) => {
    if (y + needed > PAGE_H - MARGIN) {
      doc.addPage();
      y = MARGIN;
    }
  };

  // ── Header: logo + business info ──
  let headerBottom = y;
  if (business.logoBase64) {
    try {
      const { w, h } = await loadImageSize(business.logoBase64);
      const logoH = 16;
      const logoW = Math.min(40, (w / h) * logoH);
      doc.addImage(business.logoBase64, "JPEG", MARGIN, y, logoW, logoH);
      headerBottom = Math.max(headerBottom, y + logoH);
    } catch {
      // Logo failed to embed — report still generates without it.
    }
  }
  const businessLines = [business.name, business.licenceNumber ? `Licence No. ${business.licenceNumber}` : null]
    .filter(Boolean) as string[];
  if (businessLines.length) {
    doc.setFontSize(9);
    doc.setTextColor(80);
    businessLines.forEach((line, i) => {
      doc.text(line, PAGE_W - MARGIN, y + 4 + i * 4.5, { align: "right" });
    });
    headerBottom = Math.max(headerBottom, y + 4 + businessLines.length * 4.5);
  }
  y = headerBottom + 6;

  // ── Title block ──
  doc.setFontSize(18);
  doc.setTextColor(20);
  doc.text(audit.title || "Site Audit Report", MARGIN, y);
  y += 7;

  doc.setFontSize(10);
  doc.setTextColor(90);
  const metaLine = [
    audit.site_address,
    audit.trade ? TRADE_LABELS[audit.trade] ?? audit.trade : null,
    `Generated ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}`,
  ].filter(Boolean).join("  ·  ");
  doc.text(metaLine, MARGIN, y);
  y += 8;

  // ── Summary ──
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text("Report summary", MARGIN, y);
  y += 5;
  doc.setFontSize(9);
  doc.setTextColor(60);
  const order: Array<keyof typeof summary.counts> = ["non_compliant", "concern", "cant_tell", "compliant"];
  const summaryLine = order.map((s) => `${SEVERITY_META[s].label}: ${summary.counts[s]}`).join("   ");
  doc.text(summaryLine, MARGIN, y);
  if (summary.overall) {
    doc.text(`Overall: ${SEVERITY_META[summary.overall].label}`, PAGE_W - MARGIN, y, { align: "right" });
  }
  y += 8;
  doc.setDrawColor(220);
  doc.line(MARGIN, y, PAGE_W - MARGIN, y);
  y += 8;

  // ── Per-photo sections ──
  for (const photo of photos) {
    ensureSpace(20);

    doc.setFontSize(11);
    doc.setTextColor(20);
    doc.text(photo.label || "Untitled item", MARGIN, y);
    if (photo.status === "done" && photo.severity) {
      doc.setFontSize(9);
      doc.setTextColor(90);
      doc.text(SEVERITY_META[photo.severity].label, PAGE_W - MARGIN, y, { align: "right" });
    }
    y += 5;

    if (photo.imageBase64) {
      try {
        const { w, h } = await loadImageSize(photo.imageBase64);
        const imgW = Math.min(CONTENT_W, 90);
        const imgH = (h / w) * imgW;
        ensureSpace(imgH + 4);
        doc.addImage(photo.imageBase64, "JPEG", MARGIN, y, imgW, imgH);
        y += imgH + 4;
      } catch {
        // Skip the image if it couldn't be embedded — text findings still print.
      }
    }

    if (photo.what_i_see) {
      doc.setFontSize(9);
      doc.setTextColor(70);
      const lines = doc.splitTextToSize(photo.what_i_see, CONTENT_W);
      ensureSpace(lines.length * 4.2);
      doc.text(lines, MARGIN, y);
      y += lines.length * 4.2 + 2;
    }

    for (const a of photo.assessments || []) {
      const text = `${a.point}${a.clause ? ` (${a.clause})` : ""}`;
      const lines = doc.splitTextToSize(`• ${text}`, CONTENT_W - 2);
      ensureSpace(lines.length * 4.2);
      doc.setFontSize(9);
      doc.setTextColor(40);
      doc.text(lines, MARGIN + 2, y);
      y += lines.length * 4.2;
    }

    if (photo.user_notes) {
      ensureSpace(6);
      doc.setFontSize(9);
      doc.setTextColor(90);
      const lines = doc.splitTextToSize(`Tradie's notes: ${photo.user_notes}`, CONTENT_W);
      doc.text(lines, MARGIN, y + 2);
      y += lines.length * 4.2 + 2;
    } else if (photo.needs_to_know?.length) {
      ensureSpace(6);
      doc.setFontSize(9);
      doc.setTextColor(150, 110, 0);
      const q = `Open question(s): ${photo.needs_to_know.join("; ")}`;
      const lines = doc.splitTextToSize(q, CONTENT_W);
      doc.text(lines, MARGIN, y + 2);
      y += lines.length * 4.2 + 2;
    }

    y += 4;
    doc.setDrawColor(235);
    doc.line(MARGIN, y - 2, PAGE_W - MARGIN, y - 2);
  }

  // ── Sign-off block ──
  ensureSpace(28);
  y += 4;
  doc.setFontSize(10);
  doc.setTextColor(20);
  doc.text("Sign-off", MARGIN, y);
  y += 6;
  doc.setFontSize(9);
  doc.setTextColor(60);
  const signedDate = audit.signed_off_at
    ? new Date(audit.signed_off_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })
    : "—";
  doc.text(`Signed off by: ${audit.signed_off_by || "—"}`, MARGIN, y);
  y += 5;
  doc.text(`Licence No.: ${audit.signed_off_licence || "—"}`, MARGIN, y);
  y += 5;
  doc.text(`Date: ${signedDate}`, MARGIN, y);
  y += 8;
  doc.setFontSize(8);
  doc.setTextColor(120);
  doc.text(
    doc.splitTextToSize("AI-assisted reference only — a licensed person must verify and sign off on site.", CONTENT_W),
    MARGIN, y,
  );

  // ── Page numbers ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8);
    doc.setTextColor(150);
    doc.text(`Page ${i} of ${pageCount}`, PAGE_W - MARGIN, PAGE_H - 8, { align: "right" });
  }

  return doc;
}

// Fetches a private-bucket signed URL (or any http(s) URL) and returns it as
// a base64 data URL for embedding in the PDF.
export async function urlToBase64(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}
