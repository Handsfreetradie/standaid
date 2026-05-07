"""
Core extraction logic: PDF → Claude → Supabase chunks.
"""

import io
import json
import math
import re
import time
from typing import Callable, Optional

import anthropic
import pdfplumber

BATCH_SIZE = 15          # pages per Claude call
CLAUDE_MODEL = "claude-haiku-4-5-20251001"
TARGET_CHUNK_CHARS = 2000
MAX_CHUNK_CHARS = 2500
SCANNED_PAGE_THRESHOLD = 50  # chars below this = scanned/blank page

SYSTEM_PROMPT = """You are a precise technical document parser specialising in Australian Standards (AS/NZS).

Your job is to extract every clause, table, and figure from the provided pages — nothing skipped, nothing invented.

RULES:
- Clause numbers must be EXACT as printed (e.g. "4.4.2.1" not "4.4.2")
- Content must be verbatim — do not paraphrase or summarise
- Include ALL sub-clauses, notes, informative sections, and exceptions
- If a clause number is unclear, use null — never guess
- Tables must include all column headers and every data row
- Figures must include exact caption text"""

USER_PROMPT = """Extract all clauses, tables and figures from these pages of {standard_code} {version}.

Return ONLY valid JSON — no explanation, no markdown fences:
{{
  "clauses": [
    {{
      "number": "4.4.2",
      "title": "Socket outlets — wet areas",
      "content": "Complete verbatim clause text including all sub-points, notes and exceptions.",
      "page": 234
    }}
  ],
  "tables": [
    {{
      "number": "4.1",
      "title": "Exact table title",
      "content": "All column headers and every data row as readable text.",
      "page": 235
    }}
  ],
  "figures": [
    {{
      "number": "4.2",
      "caption": "Exact figure caption",
      "page": 236
    }}
  ]
}}

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
    """
    Full pipeline: PDF bytes → Claude extraction → Supabase chunks.
    Returns summary dict.
    """

    # 1. Extract text from PDF pages
    log("Reading PDF pages...")
    pages = _pdf_to_pages(pdf_bytes)
    total = len(pages)
    log(f"  {total} pages found")

    content_pages = sum(1 for p in pages if len(p.strip()) >= SCANNED_PAGE_THRESHOLD)
    scanned_ratio = 1 - (content_pages / max(total, 1))

    if scanned_ratio > 0.5:
        log(f"  Scanned document ({round(scanned_ratio * 100)}% blank/image pages)")
        log("  ERROR: Scanned PDFs not supported yet — use a digital PDF")
        raise ValueError(
            "This PDF appears to be a scanned image. Please use a digital (text-based) PDF. "
            "Digital versions are available from Standards Australia."
        )

    log(f"  Digital PDF confirmed ({content_pages}/{total} pages with text)")

    # 2. Claude extraction in batches
    log(f"\nExtracting with Claude ({math.ceil(total / BATCH_SIZE)} batches of {BATCH_SIZE} pages)...")
    extracted = _extract_all_pages(claude, pages, standard_code, version, log)

    clause_count = len(extracted["clauses"])
    table_count = len(extracted["tables"])
    figure_count = len(extracted["figures"])
    log(f"\n  Extracted: {clause_count} clauses, {table_count} tables, {figure_count} figures")

    if clause_count == 0:
        raise ValueError("No clauses were extracted. Check that the PDF contains readable text.")

    # 3. Build Supabase-ready chunks
    log("\nBuilding chunks...")
    chunks = _build_chunks(extracted, standard_code, version)
    log(f"  {len(chunks)} chunks ready")

    # 4. Replace existing chunks in DB
    log("\nSaving to database...")
    _delete_existing_chunks(supabase, standard_id)
    _insert_chunks(supabase, chunks, standard_id, user_id)
    log(f"  {len(chunks)} chunks saved")

    # 5. Update standard record
    supabase.table("standards").update({
        "extraction_quality_score": 95,
        "total_chunks": len(chunks),
        "indexed_chunks": 0,
        "extraction_status": "processing",
    }).eq("id", standard_id).execute()

    return {
        "total_chunks": len(chunks),
        "clauses": clause_count,
        "tables": table_count,
        "figures": figure_count,
    }


# ── PDF reading ───────────────────────────────────────────────────────────────

def _pdf_to_pages(pdf_bytes: bytes) -> list[str]:
    pages = []
    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or "")
    return pages


# ── Claude extraction ─────────────────────────────────────────────────────────

def _extract_all_pages(
    claude: anthropic.Anthropic,
    pages: list[str],
    standard_code: str,
    version: str,
    log: Callable,
) -> dict:
    all_clauses: list = []
    all_tables: list = []
    all_figures: list = []

    total = len(pages)
    num_batches = math.ceil(total / BATCH_SIZE)

    for i in range(num_batches):
        start = i * BATCH_SIZE
        end = min(start + BATCH_SIZE, total)
        batch = pages[start:end]

        # Skip near-empty batches (e.g. table of contents, blank pages)
        batch_text = "\n".join(batch)
        if len(batch_text.strip()) < 200:
            log(f"  Batch {i+1}/{num_batches} (pages {start+1}–{end}): skipped (no content)")
            continue

        pages_text = ""
        for j, page_text in enumerate(batch):
            pages_text += f"\n--- PAGE {start + j + 1} ---\n{page_text}\n"

        log(f"  Batch {i+1}/{num_batches} (pages {start+1}–{end})...", end=" ", flush=True)

        result = _call_claude(claude, pages_text, standard_code, version)

        c = len(result.get("clauses", []))
        t = len(result.get("tables", []))
        f = len(result.get("figures", []))
        log(f"{c} clauses, {t} tables, {f} figures")

        all_clauses.extend(result.get("clauses", []))
        all_tables.extend(result.get("tables", []))
        all_figures.extend(result.get("figures", []))

        time.sleep(0.3)  # polite rate limit pause

    return {"clauses": all_clauses, "tables": all_tables, "figures": all_figures}


def _call_claude(
    claude: anthropic.Anthropic,
    pages_text: str,
    standard_code: str,
    version: str,
    retries: int = 3,
) -> dict:
    for attempt in range(retries):
        try:
            msg = claude.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=8000,
                system=SYSTEM_PROMPT,
                messages=[{
                    "role": "user",
                    "content": USER_PROMPT.format(
                        standard_code=standard_code,
                        version=version,
                        pages_text=pages_text,
                    ),
                }],
            )
            raw = msg.content[0].text
            raw = re.sub(r"```json\s*", "", raw)
            raw = re.sub(r"```\s*", "", raw)
            return json.loads(raw.strip())

        except json.JSONDecodeError as e:
            print(f"\n    JSON parse error (attempt {attempt+1}): {e}")
            if attempt == retries - 1:
                return {"clauses": [], "tables": [], "figures": []}

        except anthropic.RateLimitError:
            wait = 2 ** attempt * 5
            print(f"\n    Rate limit — waiting {wait}s...")
            time.sleep(wait)

        except Exception as e:
            print(f"\n    Claude error (attempt {attempt+1}): {e}")
            if attempt == retries - 1:
                return {"clauses": [], "tables": [], "figures": []}
            time.sleep(2 ** attempt)

    return {"clauses": [], "tables": [], "figures": []}


# ── Chunking ──────────────────────────────────────────────────────────────────

def _build_chunks(extracted: dict, standard_code: str, version: str) -> list[dict]:
    chunks = []
    idx = 0
    label = f"[{standard_code}{f' {version}' if version else ''}]"

    for item in extracted.get("clauses", []):
        number = (item.get("number") or "").strip()
        title  = (item.get("title")  or "").strip()
        content = (item.get("content") or "").strip()
        page   = item.get("page") or 1

        if len(content) < 10:
            continue

        breadcrumb = label
        if number:
            breadcrumb += f" Clause {number}"
            if title:
                breadcrumb += f": {title}"
        elif title:
            breadcrumb += f" {title}"
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

    for item in extracted.get("tables", []):
        number  = (item.get("number")  or "").strip()
        title   = (item.get("title")   or "").strip()
        content = (item.get("content") or "").strip()
        page    = item.get("page") or 1

        if not content:
            continue

        text = f"{label} Table {number}{f': {title}' if title else ''}\n\n{content}"
        chunks.append({
            "clause_number": f"TABLE {number}" if number else None,
            "clause_title":  title or None,
            "content":       text,
            "page_number":   page,
            "chunk_index":   idx,
        })
        idx += 1

    for item in extracted.get("figures", []):
        number  = (item.get("number")  or "").strip()
        caption = (item.get("caption") or "").strip()
        page    = item.get("page") or 1

        text = (
            f"{label} Figure {number}{f' — {caption}' if caption else ''}\n\n"
            f"Refer to Figure {number} on page {page} of the standard for the diagram.\n"
            f"Caption: {caption}"
        )
        chunks.append({
            "clause_number": f"FIGURE {number}" if number else None,
            "clause_title":  caption or None,
            "content":       text,
            "page_number":   page,
            "chunk_index":   idx,
        })
        idx += 1

    return chunks


def _split(full_text: str, breadcrumb: str) -> list[str]:
    """Split a long clause into overlapping TARGET_CHUNK_CHARS chunks."""
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


# ── Database ──────────────────────────────────────────────────────────────────

def _delete_existing_chunks(supabase, standard_id: str) -> None:
    supabase.table("standard_chunks").delete().eq("standard_id", standard_id).execute()


def _insert_chunks(supabase, chunks: list[dict], standard_id: str, user_id: str) -> None:
    BATCH = 100
    for i in range(0, len(chunks), BATCH):
        records = [
            {
                "standard_id":  standard_id,
                "user_id":      user_id,
                "clause_number": c["clause_number"],
                "clause_title":  c["clause_title"],
                "content":       c["content"],
                "page_number":   c["page_number"],
                "chunk_index":   c["chunk_index"],
                "embedding":     None,
                "is_indexed":    False,
            }
            for c in chunks[i:i + BATCH]
        ]
        supabase.table("standard_chunks").insert(records).execute()
