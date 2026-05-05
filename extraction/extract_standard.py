#!/usr/bin/env python3
"""
AS/NZS Standards Extraction Service
Primary: pdfplumber + regex (free)
Fallback: Claude Haiku (only for pages where regex finds nothing)
"""

import argparse
import json
import os
import re
import sys
import time
from datetime import datetime, UTC
from pathlib import Path

import pdfplumber
from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv()

client = Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])

PDF_NAME = "AS NZS 3000 2018 Electrical Installations (Wiring Rules).pdf"

# ---------------------------------------------------------------------------
# Regex patterns
# ---------------------------------------------------------------------------

# Clause header: "  2.10.4.1 General" or "  * 2.10.4.1 General"
# First segment 1-9 only (AS/NZS 3000 has sections 1-8; excludes 0.x, standard refs like 3008.x, 60079.x)
CLAUSE_HEADER = re.compile(r'^\s*\*?\s*([1-9](?:\.\d+)+)\s+([A-Z][^.]{2,}?)\s*$', re.MULTILINE)

# Figure caption: "FIGURE 3.2 — Multiple earthed neutral system"
FIGURE_HEADER = re.compile(
    r'^(?:FIGURE|Figure)\s+(\d+(?:\.\d+)*)\s*[—\-]\s*(.+)$', re.MULTILINE
)

# Note lines: "NOTE 1   Some note text"
NOTE_LINE = re.compile(r'^NOTES?\s*\d*\s*[:\-]?\s*(.+)$', re.MULTILINE)

# Exception/exemption lines
EXCEPTION_LINE = re.compile(r'^(?:EXCEPTION|EXEMPTION)\s*\d*\s*[:\-]?\s*(.+)$', re.MULTILINE)

# Standard references: AS/NZS 3008, AS 1768, NCC, IEC 60364, etc.
STANDARD_REF = re.compile(
    r'\b(?:AS/NZS|AS|NZS|IEC|ISO|NCC)\s+\d+(?:[.\-:]\d+)*(?::\d{4})?\b'
)

# Table references inside text: "Table 3.5", "Table 2.1"
TABLE_REF = re.compile(r'\bTable\s+(\d+(?:\.\d+)*)\b')

# Clause cross-references inside text: "Clause 3.6.1", "(see 4.2.1)"
CLAUSE_REF = re.compile(r'(?:Clause\s+|(?<=\()(?=\d))(\d+(?:\.\d+)+)')

# ---------------------------------------------------------------------------
# PDF helpers
# ---------------------------------------------------------------------------

def extract_page_text(page) -> str:
    return page.extract_text(layout=True) or ""


def extract_page_tables(page) -> list[dict]:
    raw_tables = page.extract_tables()
    tables = []
    for tbl in raw_tables:
        if not tbl or len(tbl) < 2:
            continue
        headers = [str(h).strip() if h else "" for h in tbl[0]]
        rows = []
        for row in tbl[1:]:
            row_dict = {headers[i]: str(cell).strip() if cell else "" for i, cell in enumerate(row)}
            rows.append(row_dict)
        tables.append({"columns": headers, "data": rows})
    return tables


def is_digital_pdf(pdf_path: str) -> bool:
    with pdfplumber.open(pdf_path) as pdf:
        return len(extract_page_text(pdf.pages[0]).strip()) > 100


def is_toc_or_index_page(text: str) -> bool:
    """Detect table-of-contents and back-index pages to skip them."""
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return False
    # TOC pages have many lines with dot leaders (".....")
    dot_lines = sum(1 for l in lines if "....." in l)
    if dot_lines / len(lines) > 0.25:
        return True
    # Index pages have many lines with short word + clause-number pattern (e.g. "earthing 5.5.3.4")
    index_pattern = re.compile(r'^\s*\w[\w\s]{2,30}\s+\d+\.\d+')
    index_lines = sum(1 for l in lines if index_pattern.match(l))
    if index_lines / len(lines) > 0.35:
        return True
    return False


# ---------------------------------------------------------------------------
# Regex extraction (primary — free)
# ---------------------------------------------------------------------------

def extract_references(text: str) -> dict:
    return {
        "tables": list(dict.fromkeys(TABLE_REF.findall(text))),
        "figures": [],
        "standards": list(dict.fromkeys(STANDARD_REF.findall(text))),
        "other_clauses": list(dict.fromkeys(CLAUSE_REF.findall(text))),
    }


def parse_page_regex(page_text: str, page_num: int, pending: dict | None) -> tuple[list, list, dict | None]:
    """
    Parse a page using regex. Carries pending (in-progress) clause across pages.
    Returns (completed_clauses, figures, new_pending_clause).
    """
    completed = []
    figures = []

    # Find all clause headers and their positions
    headers = list(CLAUSE_HEADER.finditer(page_text))

    # Find figures
    for m in FIGURE_HEADER.finditer(page_text):
        figures.append({
            "number": m.group(1),
            "caption": m.group(2).strip(),
            "page": page_num,
        })

    if not headers:
        # No new clause headers — everything on this page belongs to pending
        if pending:
            pending["content"] += "\n" + page_text.strip()
        return completed, figures, pending

    # Close pending clause with text before first header
    first_pos = headers[0].start()
    if pending:
        preceding = page_text[:first_pos].strip()
        if preceding:
            pending["content"] += "\n" + preceding
        completed.append(_finalise_clause(pending))
        pending = None

    # Process each header
    for i, match in enumerate(headers):
        clause_num = match.group(1)
        title = match.group(2).strip()

        # Content = text from after this header to start of next header (or end of page)
        content_start = match.end()
        content_end = headers[i + 1].start() if i + 1 < len(headers) else len(page_text)
        content = page_text[content_start:content_end].strip()

        clause = {
            "number": clause_num,
            "title": title,
            "content": content,
            "page": page_num,
            "notes": [],
            "exceptions": [],
            "references": extract_references(content),
        }

        if i < len(headers) - 1:
            # Not the last header on this page — complete it
            completed.append(_finalise_clause(clause))
        else:
            # Last header — stays pending (may continue on next page)
            pending = clause

    return completed, figures, pending


def _finalise_clause(clause: dict) -> dict:
    """Extract notes and exceptions from clause content."""
    content = clause["content"]
    notes = [m.group(1).strip() for m in NOTE_LINE.finditer(content)]
    exceptions = [m.group(1).strip() for m in EXCEPTION_LINE.finditer(content)]
    clause["notes"] = notes
    clause["exceptions"] = exceptions
    return clause


# ---------------------------------------------------------------------------
# Claude Haiku fallback (only when regex finds nothing on a content-rich page)
# ---------------------------------------------------------------------------

FALLBACK_PROMPT = """Extract clauses, tables, and figures from this AS/NZS 3000:2018 page.

Page {page_num} text:
---
{page_text}
---

Return ONLY valid JSON — no markdown, no extra text:
{{"clauses":[{{"number":"3.6.2","title":"Voltage drop","content":"...","page":{page_num},"notes":[],"exceptions":[],"references":{{"tables":[],"figures":[],"standards":[],"other_clauses":[]}}}}],"tables":[],"figures":[]}}

CRITICAL: Clause numbers must be exact as in the PDF. If unclear, omit the clause."""


def call_claude_fallback(page_num: int, page_text: str) -> dict:
    prompt = FALLBACK_PROMPT.format(page_num=page_num, page_text=page_text[:5000])
    for attempt in range(3):
        try:
            response = client.messages.create(
                model="claude-haiku-4-5-20251001",
                max_tokens=2048,
                messages=[{"role": "user", "content": prompt}],
            )
            raw = response.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json").strip()
            return json.loads(raw)
        except json.JSONDecodeError as e:
            if attempt == 2:
                return {"clauses": [], "tables": [], "figures": [], "parse_error": str(e)}
        except Exception as e:
            if attempt == 2:
                return {"clauses": [], "tables": [], "figures": [], "api_error": str(e)}
            time.sleep(2 ** attempt)
    return {"clauses": [], "tables": [], "figures": []}


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def validate_clause_number(num: str) -> bool:
    return bool(num and re.match(r"^\d+(\.\d+)+$", str(num)))


def normalise_table_ref(ref: str) -> str:
    return ref.strip().removeprefix("Table ").strip()


def merge_multipage_tables(tables: list[dict]) -> list[dict]:
    merged: dict[str, dict] = {}
    for table in tables:
        num = str(table.get("number") or "").strip()
        if not num:
            continue
        if num not in merged:
            merged[num] = {**table, "data": list(table.get("data") or [])}
        else:
            merged[num]["data"].extend(table.get("data") or [])
            if table.get("page", 9999) < merged[num].get("page", 9999):
                merged[num]["page"] = table["page"]
    return list(merged.values())


def validate_extraction(data: dict) -> tuple[dict, float]:
    clauses = data.get("clauses", [])
    tables = data.get("tables", [])

    valid_clauses = [c for c in clauses if validate_clause_number(c.get("number", ""))]
    clause_num_score = len(valid_clauses) / len(clauses) if clauses else 1.0

    clause_numbers = [c.get("number") for c in valid_clauses]
    has_duplicates = len(clause_numbers) != len(set(clause_numbers))

    tables_with_data = [t for t in tables if t.get("data")]
    table_data_score = len(tables_with_data) / len(tables) if tables else 1.0

    all_table_nums = {normalise_table_ref(str(t.get("number", ""))) for t in tables}
    ref_issues = sum(
        1 for c in valid_clauses
        for tref in c.get("references", {}).get("tables", [])
        if tref and normalise_table_ref(tref) not in all_table_nums
    )

    checks = {
        "clause_numbers_valid": clause_num_score >= 0.90,
        "no_duplicate_clauses": not has_duplicates,
        "tables_have_data": table_data_score == 1.0,
        "table_references_exist": ref_issues == 0,
        "has_content": len(clauses) > 0 or len(tables) > 0,
    }
    return checks, sum(checks.values()) / len(checks) * 100


# ---------------------------------------------------------------------------
# Checkpoint
# ---------------------------------------------------------------------------

def save_checkpoint(state: dict, page_num: int, output_dir: Path):
    path = output_dir / f"checkpoint_page_{page_num}.json"
    with open(path, "w") as f:
        json.dump(state, f, indent=2)
    print(f"  💾 Checkpoint → {path.name}")


def load_checkpoint(path: str) -> dict:
    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# Main extraction
# ---------------------------------------------------------------------------

def extract(pdf_path: str, output_path: str, start_page: int = 1,
            end_page: int | None = None, checkpoint_path: str | None = None,
            checkpoint_every: int = 50):

    pdf_path_obj = Path(pdf_path)
    output_path_obj = Path(output_path)
    output_dir = output_path_obj.parent

    if not pdf_path_obj.exists():
        print(f"❌ PDF not found: {pdf_path}")
        sys.exit(1)

    print(f"📄 {pdf_path_obj.name}")

    state: dict = {
        "metadata": {
            "standard_code": "AS/NZS 3000",
            "version": "2018",
            "title": "Electrical Installations (known as the Australian/New Zealand Wiring Rules)",
            "extraction_date": datetime.now(UTC).isoformat(),
            "extraction_quality": 0,
        },
        "sections": [],
        "clauses": [],
        "tables": [],
        "figures": [],
        "cross_references": {},
        "_processed_pages": [],
    }

    resume_from = 0
    if checkpoint_path:
        print(f"♻️  Resuming from: {checkpoint_path}")
        saved = load_checkpoint(checkpoint_path)
        state.update(saved)
        resume_from = max(state.get("_processed_pages") or [0])

    # Carry pending clause across pages
    pending_clause: dict | None = None
    fallback_count = 0

    with pdfplumber.open(pdf_path) as pdf:
        total_pages = len(pdf.pages)
        state["metadata"]["total_pages"] = total_pages

        actual_end = min(end_page or total_pages, total_pages)
        actual_start = max(start_page, resume_from + 1)

        print(f"📊 Pages {actual_start}–{actual_end} of {total_pages}")
        print(f"🔍 Primary: regex  |  Fallback: Claude Haiku\n")

        for page_num in range(actual_start, actual_end + 1):
            page = pdf.pages[page_num - 1]
            page_text = extract_page_text(page)
            page_tables_raw = extract_page_tables(page)

            pct = (page_num - actual_start + 1) / (actual_end - actual_start + 1) * 100
            print(f"🔄 Page {page_num}/{actual_end} ({pct:.0f}%)", end="  ")

            # Skip TOC and index pages — they'd pollute clauses with wrong entries
            if is_toc_or_index_page(page_text):
                print("⏭️  TOC/index — skipped")
                state["_processed_pages"].append(page_num)
                continue

            # --- Primary: regex ---
            new_clauses, new_figures, pending_clause = parse_page_regex(
                page_text, page_num, pending_clause
            )

            # --- Fallback: Claude Haiku (only for scanned/image pages with no extractable text) ---
            used_fallback = False
            if len(page_text.strip()) < 150 and not page_tables_raw:
                result = call_claude_fallback(page_num, page_text)
                new_clauses = result.get("clauses", [])
                for t in result.get("tables", []):
                    t["page"] = page_num
                    state["tables"].append(t)
                for fig in result.get("figures", []):
                    fig["page"] = page_num
                    new_figures.append(fig)
                fallback_count += 1
                used_fallback = True

            # Merge pdfplumber tables
            for tbl in page_tables_raw:
                # Try to detect table number from nearby text
                tbl["page"] = page_num
                tbl["number"] = _detect_table_number(page_text, state["tables"])
                tbl["title"] = _detect_table_title(page_text)
                state["tables"].append(tbl)

            state["clauses"].extend(new_clauses)
            state["figures"].extend(new_figures)
            state["_processed_pages"].append(page_num)

            tag = " [haiku]" if used_fallback else ""
            print(f"+{len(new_clauses)} clauses  +{len(page_tables_raw)} tables  "
                  f"+{len(new_figures)} figures{tag}")

            if page_num % checkpoint_every == 0:
                save_checkpoint(state, page_num, output_dir)

    # Close last pending clause
    if pending_clause:
        state["clauses"].append(_finalise_clause(pending_clause))

    # Post-processing: drop invalid numbers, then deduplicate (keep first real occurrence)
    before = len(state["clauses"])
    state["clauses"] = [c for c in state["clauses"] if validate_clause_number(c.get("number", ""))]

    seen: set[str] = set()
    deduped = []
    for c in state["clauses"]:
        if c["number"] not in seen:
            seen.add(c["number"])
            deduped.append(c)
    state["clauses"] = deduped

    dropped = before - len(state["clauses"])

    state["tables"] = merge_multipage_tables(state["tables"])

    # Cross-reference index
    cross_refs: dict[str, list[str]] = {}
    for clause in state["clauses"]:
        for std in clause.get("references", {}).get("standards", []):
            cross_refs.setdefault(std, []).append(clause.get("number", ""))
    state["cross_references"] = cross_refs

    checks, quality_score = validate_extraction(state)
    state["metadata"]["extraction_quality"] = round(quality_score, 1)
    state["metadata"]["fallback_pages"] = fallback_count
    state.pop("_processed_pages", None)

    with open(output_path, "w") as f:
        json.dump(state, f, indent=2)

    # Summary
    print(f"\n{'=' * 60}")
    print(f"✅ Done → {output_path}")
    print(f"   Clauses:       {len(state['clauses'])}  ({dropped} null dropped)")
    print(f"   Tables:        {len(state['tables'])}")
    print(f"   Figures:       {len(state['figures'])}")
    print(f"   Haiku pages:   {fallback_count}")
    print(f"   Quality:       {quality_score:.0f}%")
    print()
    for check, passed in checks.items():
        print(f"  {'✅' if passed else '❌'} {check}")

    return state


# ---------------------------------------------------------------------------
# Table detection helpers
# ---------------------------------------------------------------------------

_TABLE_NUM_RE = re.compile(r'TABLE\s+(\d+(?:\.\d+)*)', re.IGNORECASE)
_TABLE_TITLE_RE = re.compile(r'TABLE\s+\d+(?:\.\d+)*\s*[—\-]?\s*(.+)', re.IGNORECASE)


def _detect_table_number(page_text: str, existing_tables: list) -> str | None:
    """Find the table number from page text (looks for 'TABLE 3.5' etc.)."""
    existing_nums = {str(t.get("number", "")) for t in existing_tables}
    for m in _TABLE_NUM_RE.finditer(page_text):
        num = m.group(1)
        if num not in existing_nums:
            return num
    return None


def _detect_table_title(page_text: str) -> str | None:
    m = _TABLE_TITLE_RE.search(page_text)
    return m.group(1).strip()[:80] if m else None


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Extract AS/NZS standards from PDF")
    parser.add_argument("--pdf", default=PDF_NAME)
    parser.add_argument("--output", default="as-nzs-3000-2018.json")
    parser.add_argument("--start-page", type=int, default=1)
    parser.add_argument("--end-page", type=int, default=None)
    parser.add_argument("--resume", default=None)
    parser.add_argument("--checkpoint-every", type=int, default=50)
    args = parser.parse_args()

    extract(
        pdf_path=args.pdf,
        output_path=args.output,
        start_page=args.start_page,
        end_page=args.end_page,
        checkpoint_path=args.resume,
        checkpoint_every=args.checkpoint_every,
    )


if __name__ == "__main__":
    main()
