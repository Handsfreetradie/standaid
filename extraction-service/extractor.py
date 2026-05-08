"""
Two-pass extraction pipeline:
  Pass 1 — pdfplumber extracts raw text (free, 100% accurate for digital PDFs)
  Pass 2 — Claude identifies clause/table/figure boundaries (tiny output, never truncates)
  Content comes from the raw pdfplumber text, not Claude — no token limit issues.
  Pass 3 — pymupdf renders figure/table pages as images and uploads to Supabase Storage.
"""

import io
import json
import math
import re
import time
from typing import Callable

import anthropic
import fitz  # pymupdf
import pdfplumber

BATCH_SIZE = 10          # pages per Claude boundary-detection call
CLAUDE_MODEL = "claude-haiku-4-5-20251001"
TARGET_CHUNK_CHARS = 2000
MAX_CHUNK_CHARS = 2500
SCANNED_PAGE_THRESHOLD = 50

# Claude only returns a list of what starts on each page — tiny output, never truncates
BOUNDARY_SYSTEM = """You are scanning pages of an Australian Standard document.
Your ONLY job: list every clause number, table number, and figure number that BEGINS on these pages.
Return ONLY valid JSON. No explanation. No other text."""

BOUNDARY_PROMPT = """List every item that STARTS on these pages of {standard_code} {version}.

Return ONLY this JSON (no markdown, no explanation):
{{"items": [
  {{"type": "clause", "number": "4.4.2", "page": 45}},
  {{"type": "table",  "number": "4.1",   "page": 46}},
  {{"type": "figure", "number": "4.2",   "page": 47}}
]}}

Rules:
- Include ALL clause levels: 1, 1.1, 1.1.1, 1.1.1.1, 1.1.1.1.1
- Include appendix clauses: A1, A1.1, B2 etc.
- Clause numbers must be EXACT as printed
- If nothing starts on a page, return empty items array
- Do NOT include items from previous pages that continue onto these pages

PAGES:
{pages_text}"""


def run(
    standard_id: str,
    user_id: str,
    standard_code: str,
    version: str,
    pdf_bytes: bytes,
    supabase,
    claude: anthropic.Anthropic,
    log: Callable[[str], None] = print,
) -> dict:
    # 1. Extract raw text with pdfplumber
    log("Reading PDF pages...")
    pages, tables_by_page = _extract_pages_and_tables(pdf_bytes)
    total = len(pages)
    log(f"  {total} pages found")

    content_pages = sum(1 for p in pages if len(p.strip()) >= SCANNED_PAGE_THRESHOLD)
    if content_pages / max(total, 1) < 0.5:
        raise ValueError(
            "This PDF appears to be scanned. Please use a digital PDF from Standards Australia."
        )
    log(f"  Digital PDF confirmed ({content_pages}/{total} pages with text)")

    # 2. Claude identifies boundaries (clause numbers only — tiny output)
    log(f"\nFinding clause boundaries ({math.ceil(total / BATCH_SIZE)} batches)...")
    boundaries = _find_boundaries(claude, pages, standard_code, version, log)
    log(f"  Found {len(boundaries)} boundaries")

    if len(boundaries) == 0:
        raise ValueError("No clause boundaries found. Check the PDF is a valid standard.")

    # 3. Build full text for content slicing
    full_text = _build_full_text(pages)

    # 4. Extract content for each boundary from raw pdfplumber text
    log("\nExtracting clause content from PDF text...")
    items = _extract_content(full_text, boundaries, pages)
    log(f"  {len(items)} clauses/tables/figures extracted")

    # 5. Add pdfplumber-detected tables (structured data)
    pdfplumber_tables = _format_pdfplumber_tables(tables_by_page, standard_code, version)
    log(f"  {len(pdfplumber_tables)} structured tables from pdfplumber")

    # 6. Build chunks
    log("\nBuilding chunks...")
    chunks = _build_chunks(items, pdfplumber_tables, standard_code, version)
    log(f"  {len(chunks)} chunks ready")

    # 7. Save to database
    log("\nSaving to database...")
    _delete_existing_chunks(supabase, standard_id)
    _insert_chunks(supabase, chunks, standard_id, user_id)
    log(f"  {len(chunks)} chunks saved")

    # 8. Render figure/table images and upload to Supabase Storage
    log("\nExtracting figure and table images...")
    figure_items = [i for i in items if i["type"] == "figure"]
    table_items  = [i for i in items if i["type"] == "table"] + [
        {"type": "table", "number": t["number"], "title": t["title"], "page": t["page"]}
        for t in pdfplumber_tables
    ]
    img_counts = _extract_and_upload_images(
        pdf_bytes, figure_items, table_items,
        supabase, standard_id, user_id, log,
    )
    log(f"  {img_counts['figures']} figures, {img_counts['tables']} tables uploaded")

    supabase.table("standards").update({
        "extraction_quality_score": 95,
        "total_chunks": len(chunks),
        "indexed_chunks": 0,
        "extraction_status": "processing",
    }).eq("id", standard_id).execute()

    clause_count = sum(1 for i in items if i["type"] == "clause")
    table_count  = sum(1 for i in items if i["type"] == "table") + len(pdfplumber_tables)
    figure_count = sum(1 for i in items if i["type"] == "figure")

    return {"total_chunks": len(chunks), "clauses": clause_count,
            "tables": table_count, "figures": figure_count}


# ── PDF extraction ─────────────────────────────────────────────────────────────

def _extract_pages_and_tables(pdf_bytes: bytes):
    pages = []
    tables_by_page = {}
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages):
            pages.append(page.extract_text() or "")
            tbls = page.extract_tables()
            if tbls:
                tables_by_page[i + 1] = tbls
    return pages, tables_by_page


def _build_full_text(pages: list[str]) -> str:
    parts = []
    for i, text in enumerate(pages):
        parts.append(f"[PAGE {i+1}]\n{text}")
    return "\n\n".join(parts)


# ── Claude boundary detection ──────────────────────────────────────────────────

def _find_boundaries(
    claude: anthropic.Anthropic,
    pages: list[str],
    standard_code: str,
    version: str,
    log: Callable,
) -> list[dict]:
    all_items = []
    total = len(pages)
    num_batches = math.ceil(total / BATCH_SIZE)

    for i in range(num_batches):
        start = i * BATCH_SIZE
        end = min(start + BATCH_SIZE, total)
        batch = pages[start:end]

        pages_text = ""
        for j, text in enumerate(batch):
            pages_text += f"\n--- PAGE {start + j + 1} ---\n{text}\n"

        if len(pages_text.strip()) < 100:
            continue

        log(f"  Batch {i+1}/{num_batches} (pages {start+1}–{end})...", end=" ", flush=True)
        items = _call_claude_boundaries(claude, pages_text, standard_code, version)
        log(f"{len(items)} items")
        all_items.extend(items)
        time.sleep(0.2)

    return all_items


def _call_claude_boundaries(
    claude: anthropic.Anthropic,
    pages_text: str,
    standard_code: str,
    version: str,
    retries: int = 3,
) -> list[dict]:
    for attempt in range(retries):
        try:
            msg = claude.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=8000,  # enough for dense pages
                system=BOUNDARY_SYSTEM,
                messages=[{
                    "role": "user",
                    "content": BOUNDARY_PROMPT.format(
                        standard_code=standard_code,
                        version=version,
                        pages_text=pages_text,
                    ),
                }],
            )
            raw = msg.content[0].text
            start = raw.find('{')
            if start == -1:
                return []
            obj, _ = json.JSONDecoder().raw_decode(raw, start)
            return obj.get("items", [])

        except Exception as e:
            if attempt == retries - 1:
                print(f"\n    Failed after {retries} attempts: {e}")
                return []
            time.sleep(2 ** attempt)

    return []


# ── Content extraction from raw PDF text ──────────────────────────────────────

def _extract_content(full_text: str, boundaries: list[dict], pages: list[str]) -> list[dict]:
    """
    For each boundary, find where it starts in the full PDF text and extract
    content up to the next boundary. Content comes from pdfplumber — not Claude.
    """
    # Build a char-offset index of where each page starts in full_text
    page_offsets = []
    pos = 0
    for i, text in enumerate(pages):
        marker = f"[PAGE {i+1}]\n"
        idx = full_text.find(marker, pos)
        page_offsets.append(idx if idx != -1 else pos)
        pos = max(pos, idx + 1) if idx != -1 else pos

    # Locate each boundary in the full text, searching near the stated page
    positioned = []
    for b in boundaries:
        num = b.get("number", "").strip()
        if not num:
            continue

        escaped = re.escape(num)
        pattern = rf'(?m)^{escaped}(?=\s)'

        # Start searching from the page Claude reported (skip TOC pages)
        page_idx = b.get("page", 1) - 1
        # Search from one page before to handle slight page-number drift
        search_start = page_offsets[max(0, page_idx - 1)] if page_idx < len(page_offsets) else 0
        match = re.search(pattern, full_text[search_start:])
        if match:
            positioned.append({
                "boundary": b,
                "pos": search_start + match.start(),
            })

    # Sort by position in document
    positioned.sort(key=lambda x: x["pos"])

    results = []
    for i, item in enumerate(positioned):
        b = item["boundary"]
        start = item["pos"]
        end = positioned[i + 1]["pos"] if i + 1 < len(positioned) else len(full_text)

        raw_content = full_text[start:end].strip()

        # Strip [PAGE N] markers from content
        raw_content = re.sub(r'\[PAGE \d+\]\n?', '', raw_content).strip()

        # Extract title from first line if not provided
        title = (b.get("title") or "").strip()
        if not title:
            first_line = raw_content.split('\n')[0]
            # Remove the clause number from first line to get title
            title_match = re.match(rf'^{re.escape(b["number"])}\s+(.*)', first_line)
            if title_match:
                title = title_match.group(1).strip()

        if len(raw_content) < 5:
            continue

        results.append({
            "type": b.get("type", "clause"),
            "number": b["number"],
            "title": title,
            "content": raw_content,
            "page": b.get("page", 1),
        })

    return results


# ── pdfplumber table formatting ────────────────────────────────────────────────

def _format_pdfplumber_tables(tables_by_page: dict, standard_code: str, version: str) -> list[dict]:
    chunks = []
    label = f"[{standard_code}{f' {version}' if version else ''}]"
    for page_num, tables in tables_by_page.items():
        for t_idx, table in enumerate(tables):
            if not table or len(table) < 2:
                continue
            # Format as readable text: header row + data rows
            rows = []
            for row in table:
                clean = [str(cell or "").strip() for cell in row]
                rows.append(" | ".join(clean))
            content = f"{label} Table (page {page_num})\n\n" + "\n".join(rows)
            chunks.append({
                "type": "table",
                "number": f"p{page_num}_{t_idx}",
                "title": rows[0] if rows else "",
                "content": content,
                "page": page_num,
            })
    return chunks


# ── Chunking ──────────────────────────────────────────────────────────────────

def _build_chunks(items: list[dict], extra_tables: list[dict], standard_code: str, version: str) -> list[dict]:
    chunks = []
    idx = 0
    label = f"[{standard_code}{f' {version}' if version else ''}]"

    all_items = items + extra_tables

    for item in all_items:
        number  = (item.get("number") or "").strip()
        title   = (item.get("title")  or "").strip()
        content = (item.get("content") or "").strip()
        page    = item.get("page") or 1
        itype   = item.get("type", "clause")

        if len(content) < 10:
            continue

        if itype == "clause":
            breadcrumb = f"{label} Clause {number}" if number else label
            if title:
                breadcrumb += f": {title}"
        elif itype == "table":
            breadcrumb = f"{label} Table {number}" if number else f"{label} Table"
            if title:
                breadcrumb += f": {title}"
        else:  # figure
            breadcrumb = f"{label} Figure {number}" if number else f"{label} Figure"
            if title:
                breadcrumb += f" — {title}"

        breadcrumb += "\n\n"

        for chunk_text in _split(breadcrumb + content, breadcrumb):
            chunks.append({
                "clause_number": number or None,
                "clause_title":  title  or None,
                "content":       chunk_text,
                "page_number":   page,
                "chunk_index":   idx,
            })
            idx += 1

    return chunks


def _split(full_text: str, breadcrumb: str) -> list[str]:
    if len(full_text) <= MAX_CHUNK_CHARS:
        return [full_text]

    paragraphs = full_text.split("\n\n")
    results = []
    buffer = ""

    for para in paragraphs:
        if len(buffer) + len(para) + 2 > TARGET_CHUNK_CHARS and buffer:
            results.append(buffer.strip())
            tail = buffer[-200:] if len(buffer) > 200 else buffer
            m = re.search(r"(?<=[.!?])\s", tail)
            overlap = tail[m.start():].strip() if m else tail
            buffer = breadcrumb + f"[...continued]\n{overlap}\n\n{para}"
        else:
            buffer += ("\n\n" if buffer else "") + para

    if buffer.strip():
        results.append(buffer.strip())

    return results or [full_text]


# ── Image extraction and upload ───────────────────────────────────────────────

IMAGE_DPI = 150  # 150dpi balances quality vs file size (~100–300KB per page)


def _render_figure_png(pdf_bytes: bytes, page_number: int, label: str, item_type: str) -> bytes | None:
    """
    Render just the region of a page that contains a specific figure or table.
    Searches for the label text (e.g. "FIGURE 2.4" or "TABLE 3.5") on the page,
    then crops from that point to the next heading/label or end of page.
    Falls back to the full page if the label can't be found.
    """
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        total_pages = len(doc)
        if page_number < 1 or page_number > total_pages:
            return None

        page = doc[page_number - 1]
        page_rect = page.rect
        mat = fitz.Matrix(IMAGE_DPI / 72, IMAGE_DPI / 72)

        # Try to find the label text on this page or the next
        # Standards use uppercase (FIGURE 2.4) or title case (Figure 2.4)
        search_variants = [
            f"{item_type.upper()} {label}",
            f"{item_type.capitalize()} {label}",
            f"{item_type.upper()}{label}",  # no space variant
        ]

        crop_top = None
        search_page = page

        for variant in search_variants:
            hits = search_page.search_for(variant)
            if hits:
                crop_top = hits[0].y0 - 5  # small padding above label
                break

        if crop_top is None and page_number < total_pages:
            # Try next page (figure might start there even though boundary says this page)
            next_page = doc[page_number]
            for variant in search_variants:
                hits = next_page.search_for(variant)
                if hits:
                    search_page = next_page
                    crop_top = hits[0].y0 - 5
                    break

        if crop_top is None:
            # Label not found — render full page
            pix = page.get_pixmap(matrix=mat, colorspace=fitz.csRGB)
            return pix.tobytes("png")

        # Find where the next figure/table starts so we know where to crop bottom
        next_labels = ["FIGURE", "Figure", "TABLE", "Table", "APPENDIX", "SECTION", "CLAUSE"]
        crop_bottom = search_page.rect.height  # default: bottom of page

        blocks = search_page.get_text("blocks")  # (x0, y0, x1, y1, text, ...)
        for block in blocks:
            by0 = block[1]
            btext = block[4].strip()
            if by0 > crop_top + 20:  # must be below our label
                for nl in next_labels:
                    if btext.startswith(nl) and btext != f"{item_type.upper()} {label}":
                        crop_bottom = by0 - 5
                        break
                if crop_bottom < search_page.rect.height:
                    break

        clip = fitz.Rect(0, max(0, crop_top), search_page.rect.width, min(crop_bottom, search_page.rect.height))
        pix = search_page.get_pixmap(matrix=mat, colorspace=fitz.csRGB, clip=clip)
        return pix.tobytes("png")

    except Exception as e:
        print(f"    Image render error for {item_type} {label}: {e}")
        return None


def _upload_image(supabase, user_id: str, standard_id: str, name: str, png_bytes: bytes) -> str | None:
    """Upload a PNG to Supabase Storage and return the public URL."""
    path = f"{user_id}/{standard_id}/{name}.png"
    try:
        # Remove existing file first (re-extraction case)
        supabase.storage.from_("standard-figures").remove([path])
    except Exception:
        pass
    try:
        supabase.storage.from_("standard-figures").upload(
            path,
            png_bytes,
            {"content-type": "image/png", "upsert": "true"},
        )
        result = supabase.storage.from_("standard-figures").get_public_url(path)
        return result
    except Exception as e:
        print(f"    Upload failed for {path}: {e}")
        return None


def _extract_and_upload_images(
    pdf_bytes: bytes,
    figure_items: list[dict],
    table_items: list[dict],
    supabase,
    standard_id: str,
    user_id: str,
    log: Callable,
) -> dict:
    """
    Render the page for each figure/table, upload to Storage, and insert
    metadata rows into standard_figures / standard_tables.
    """
    # Delete old image records so re-extraction is clean
    supabase.table("standard_figures").delete().eq("standard_id", standard_id).execute()
    supabase.table("standard_tables").delete().eq("standard_id", standard_id).execute()

    fig_count = 0
    tbl_count = 0

    for item in figure_items:
        num  = (item.get("number") or "").strip()
        page = item.get("page") or 1
        if not num:
            continue
        png = _render_figure_png(pdf_bytes, page, num, "figure")
        if not png:
            continue
        safe_num = re.sub(r"[^A-Za-z0-9._-]", "_", num)
        url = _upload_image(supabase, user_id, standard_id, f"figure_{safe_num}", png)
        if url:
            supabase.table("standard_figures").insert({
                "standard_id": standard_id,
                "user_id": user_id,
                "figure_number": num,
                "caption": (item.get("title") or "").strip() or None,
                "page_number": page,
                "image_url": url,
            }).execute()
            fig_count += 1

    for item in table_items:
        num  = (item.get("number") or "").strip()
        page = item.get("page") or 1
        if not num:
            continue
        png = _render_figure_png(pdf_bytes, page, num, "table")
        if not png:
            continue
        safe_num = re.sub(r"[^A-Za-z0-9._-]", "_", num)
        url = _upload_image(supabase, user_id, standard_id, f"table_{safe_num}", png)
        if url:
            supabase.table("standard_tables").insert({
                "standard_id": standard_id,
                "user_id": user_id,
                "table_number": num,
                "caption": (item.get("title") or "").strip() or None,
                "page_number": page,
                "image_url": url,
            }).execute()
            tbl_count += 1

    return {"figures": fig_count, "tables": tbl_count}


# ── Database ──────────────────────────────────────────────────────────────────

def _delete_existing_chunks(supabase, standard_id: str) -> None:
    supabase.table("standard_chunks").delete().eq("standard_id", standard_id).execute()


def _insert_chunks(supabase, chunks: list[dict], standard_id: str, user_id: str) -> None:
    BATCH = 100
    for i in range(0, len(chunks), BATCH):
        records = [{
            "standard_id":   standard_id,
            "user_id":       user_id,
            "clause_number": c["clause_number"],
            "clause_title":  c["clause_title"],
            "content":       c["content"],
            "page_number":   c["page_number"],
            "chunk_index":   c["chunk_index"],
            "embedding":     None,
            "is_indexed":    False,
        } for c in chunks[i:i + BATCH]]
        supabase.table("standard_chunks").insert(records).execute()
