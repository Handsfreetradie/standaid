#!/usr/bin/env python3
"""
Load extracted AS/NZS 3000 JSON into Supabase.
- Creates a record in `standards`
- Chunks each clause (max 2000 chars)
- Loads table chunks (formatted as text)
- Loads figure chunks (with Claude Haiku vision descriptions)
- Generates OpenAI embeddings in batches
- Inserts into `standard_chunks` with embeddings
"""

import base64
import io
import json
import os
import sys
import time
from textwrap import wrap

import anthropic
from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
ANTHROPIC_API_KEY = os.environ["ANTHROPIC_API_KEY"]

EMBED_MODEL = "text-embedding-3-small"
EMBED_DIMS = 1536
MAX_CHUNK_CHARS = 2000
EMBED_BATCH_SIZE = 100   # OpenAI allows up to 2048
INSERT_BATCH_SIZE = 50   # Supabase REST comfortable batch size

HAIKU_MODEL = "claude-haiku-4-5-20251001"
FIGURE_BATCH_SIZE = 5

supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
openai_client = OpenAI(api_key=OPENAI_API_KEY)
anthropic_client = anthropic.Anthropic(api_key=ANTHROPIC_API_KEY)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def get_user_id(email: str) -> str:
    """Look up user ID by email via admin API."""
    res = supabase.auth.admin.list_users()
    for user in res:
        if user.email == email:
            return user.id
    raise ValueError(f"User not found: {email}")


def split_clause_to_chunks(clause: dict) -> list[dict]:
    """
    Split a clause into <=2000-char chunks.
    Each chunk gets the clause number/title as a prefix for context.
    """
    prefix = f"AS/NZS 3000:2018 Clause {clause['number']} — {clause['title']}\n\n"
    body = clause.get("content", "").strip()

    # Include notes in body
    for note in clause.get("notes", []):
        body += f"\nNOTE: {note}"

    full_text = prefix + body if body else prefix.strip()

    if len(full_text) <= MAX_CHUNK_CHARS:
        return [{"text": full_text, "clause": clause}]

    # Split on sentence boundaries to stay under limit
    sentences = full_text.replace("\n", " ").split(". ")
    chunks = []
    current = ""
    for sentence in sentences:
        candidate = current + sentence + ". "
        if len(candidate) > MAX_CHUNK_CHARS and current:
            chunks.append({"text": current.strip(), "clause": clause})
            current = prefix + sentence + ". "
        else:
            current = candidate
    if current.strip():
        chunks.append({"text": current.strip(), "clause": clause})

    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts via OpenAI. Returns list of embedding vectors."""
    response = openai_client.embeddings.create(model=EMBED_MODEL, input=texts)
    return [item.embedding for item in response.data]


def embed_in_batches(chunks: list[dict]) -> list[dict]:
    """Add 'embedding' key to each chunk dict."""
    total = len(chunks)
    for i in range(0, total, EMBED_BATCH_SIZE):
        batch = chunks[i:i + EMBED_BATCH_SIZE]
        texts = [c["text"] for c in batch]
        print(f"  Embedding {i + 1}–{min(i + EMBED_BATCH_SIZE, total)} / {total}...", end="\r")
        try:
            vectors = embed_texts(texts)
            for chunk, vec in zip(batch, vectors):
                chunk["embedding"] = vec
        except Exception as e:
            print(f"\n  WARNING: Embed error on batch {i}: {e} — retrying in 5s")
            time.sleep(5)
            vectors = embed_texts(texts)
            for chunk, vec in zip(batch, vectors):
                chunk["embedding"] = vec
    print()
    return chunks


def insert_chunks(chunks: list[dict], standard_id: str, user_id: str):
    """Insert chunks into standard_chunks in batches."""
    total = len(chunks)
    for i in range(0, total, INSERT_BATCH_SIZE):
        batch = chunks[i:i + INSERT_BATCH_SIZE]
        records = [
            {
                "standard_id": standard_id,
                "user_id": user_id,
                "clause_number": c["clause"]["number"],
                "clause_title": c["clause"]["title"],
                "content": c["text"],
                "page_number": c["clause"].get("page"),
                "chunk_index": i + j,
                "embedding": c["embedding"],
                "is_indexed": True,
            }
            for j, c in enumerate(batch)
        ]
        supabase.table("standard_chunks").insert(records).execute()
        print(f"  Inserted {min(i + INSERT_BATCH_SIZE, total)}/{total} chunks", end="\r")
    print()


# ---------------------------------------------------------------------------
# Table chunks
# ---------------------------------------------------------------------------

def format_table_content(table: dict) -> str:
    """Format a table dict into a readable text block."""
    number = table.get("number", "")
    title = table.get("title", "")
    columns = table.get("columns", [])
    rows = table.get("data", [])

    lines = [f"AS/NZS 3000:2018 Table {number} — {title}", ""]

    # Header row
    if columns:
        lines.append(" | ".join(str(c) for c in columns))
        lines.append("-" * min(80, sum(len(str(c)) + 3 for c in columns)))

    # Data rows
    for row in rows:
        if isinstance(row, dict):
            # Row is a dict keyed by column name
            values = [str(row.get(col, "")).replace("\n", " ") for col in columns]
            lines.append(" | ".join(values))
        elif isinstance(row, list):
            lines.append(" | ".join(str(v).replace("\n", " ") for v in row))

    searchable = table.get("searchable_text", "").strip()
    if searchable:
        lines.append("")
        lines.append(searchable)

    return "\n".join(lines)


def load_tables(data: dict, chunks: list) -> int:
    """Build chunk dicts for all tables and append to chunks list. Returns count."""
    tables = data.get("tables", [])
    if not tables:
        print("   No tables found in JSON.")
        return 0

    print(f"   Building {len(tables)} table chunks...")
    for table in tables:
        number = table.get("number", "")
        title = table.get("title", "")
        page = table.get("page")
        content = format_table_content(table)

        # Truncate if over limit (tables shouldn't be huge but just in case)
        if len(content) > MAX_CHUNK_CHARS:
            content = content[:MAX_CHUNK_CHARS - 3] + "..."

        chunks.append({
            "text": content,
            "clause": {
                "number": f"TABLE {number}",
                "title": title,
                "page": page,
            },
        })

    return len(tables)


# ---------------------------------------------------------------------------
# Figure chunks (Claude Haiku vision)
# ---------------------------------------------------------------------------

def render_page_as_base64(pdf_path: str, page_number: int) -> str | None:
    """
    Render a PDF page to a base64-encoded PNG using pdfplumber.
    page_number is 1-based.
    Returns None on failure.
    """
    try:
        import pdfplumber
        from PIL import Image

        with pdfplumber.open(pdf_path) as pdf:
            # pdfplumber pages are 0-indexed
            page = pdf.pages[page_number - 1]
            pil_image = page.to_image(resolution=150).original

            buf = io.BytesIO()
            pil_image.save(buf, format="PNG")
            buf.seek(0)
            return base64.standard_b64encode(buf.read()).decode("utf-8")
    except Exception as e:
        print(f"\n  WARNING: Could not render page {page_number}: {e}")
        return None


def describe_figure_with_haiku(number: str, caption: str, page: int, image_b64: str) -> str:
    """Call Claude Haiku vision to describe a figure."""
    prompt = (
        f"You are helping Australian tradies understand technical diagrams from AS/NZS 3000:2018 Wiring Rules.\n\n"
        f"This is Figure {number} — {caption}, on page {page}.\n\n"
        f"Describe this diagram for a tradie on the job:\n"
        f"1. What does this diagram show? (2-3 sentences)\n"
        f"2. What should a tradie look for when checking their installation against this diagram? (3-4 dot points)\n"
        f"3. What are the most common mistakes or things inspectors check? (2-3 dot points)\n\n"
        f"Be practical, plain English, no waffle."
    )

    message = anthropic_client.messages.create(
        model=HAIKU_MODEL,
        max_tokens=1024,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": "image/png",
                            "data": image_b64,
                        },
                    },
                    {
                        "type": "text",
                        "text": prompt,
                    },
                ],
            }
        ],
    )
    return message.content[0].text


def load_figures(data: dict, chunks: list, pdf_path: str) -> int:
    """Build chunk dicts for all figures (with vision descriptions) and append to chunks. Returns count."""
    figures = data.get("figures", [])
    if not figures:
        print("   No figures found in JSON.")
        return 0

    print(f"   Processing {len(figures)} figures with Claude Haiku vision...")

    for batch_start in range(0, len(figures), FIGURE_BATCH_SIZE):
        batch = figures[batch_start:batch_start + FIGURE_BATCH_SIZE]

        for figure in batch:
            number = figure.get("number", "")
            caption = figure.get("caption", figure.get("title", ""))
            page = figure.get("page")

            # Try to get a vision description
            description = None
            if page:
                image_b64 = render_page_as_base64(pdf_path, page)
                if image_b64:
                    try:
                        description = describe_figure_with_haiku(number, caption, page, image_b64)
                        print(f"  Figure {number} (page {page}) — described ✅")
                    except Exception as e:
                        print(f"\n  WARNING: Vision API failed for Figure {number}: {e}")

            if description:
                content = (
                    f"AS/NZS 3000:2018 Figure {number} — {caption} (Page {page})\n\n"
                    f"{description}\n\n"
                    f"Refer to Figure {number} on page {page} of your copy of AS/NZS 3000:2018."
                )
            else:
                # Fallback: just caption
                content = (
                    f"AS/NZS 3000:2018 Figure {number} — {caption} (Page {page})\n\n"
                    f"See Figure {number} on page {page} of AS/NZS 3000:2018 for the diagram.\n\n"
                    f"Refer to Figure {number} on page {page} of your copy of AS/NZS 3000:2018."
                )
                print(f"  Figure {number} (page {page}) — fallback (no description)")

            chunks.append({
                "text": content,
                "clause": {
                    "number": f"FIGURE {number}",
                    "title": caption,
                    "page": page,
                },
            })

        # Rate limit pause between batches (not after the last one)
        if batch_start + FIGURE_BATCH_SIZE < len(figures):
            time.sleep(1)

    return len(figures)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def load(json_path: str, user_email: str, dry_run: bool = False):
    print(f"Loading: {json_path}")

    with open(json_path) as f:
        data = json.load(f)

    meta = data["metadata"]
    clauses = data["clauses"]
    tables = data.get("tables", [])
    figures = data.get("figures", [])
    print(f"   Standard: {meta['standard_code']}:{meta['version']}")
    print(f"   Clauses:  {len(clauses)}")
    print(f"   Tables:   {len(tables)}")
    print(f"   Figures:  {len(figures)}")

    # PDF path for figure rendering (relative to JSON location)
    pdf_path = os.path.join(
        os.path.dirname(os.path.abspath(json_path)),
        "..",
        "AS NZS 3000 2018 Electrical Installations (Wiring Rules).pdf",
    )
    pdf_path = os.path.normpath(pdf_path)

    # Get user ID
    print(f"\nLooking up user: {user_email}")
    user_id = get_user_id(user_email)
    print(f"   User ID:  {user_id}")

    # Check for existing standard record
    existing = supabase.table("standards") \
        .select("id") \
        .eq("user_id", user_id) \
        .eq("standard_code", meta["standard_code"]) \
        .eq("version", meta["version"]) \
        .execute()

    if existing.data:
        old_id = existing.data[0]["id"]
        print(f"\nReplacing existing standard (id={old_id})")
        if not dry_run:
            # Delete chunks first (FK), then the standard record, then recreate cleanly
            supabase.table("standard_chunks").delete().eq("standard_id", old_id).execute()
            supabase.table("standards").delete().eq("id", old_id).execute()

    print(f"\nCreating standards record")
    if not dry_run:
        result = supabase.table("standards").insert({
            "user_id": user_id,
            "title": meta["title"],
            "standard_code": meta["standard_code"],
            "version": meta["version"],
            "trade_category": "electrical",
            "extraction_status": "processing",  # will update to "complete" after insert
            "extraction_quality_score": meta.get("extraction_quality", 0),
            "is_partial": False,
            "total_chunks": 0,
            "indexed_chunks": 0,
        }).execute()
        standard_id = result.data[0]["id"]
        print(f"   ID: {standard_id}")
    else:
        standard_id = "DRY-RUN"

    # Build clause chunks
    print(f"\nChunking {len(clauses)} clauses...")
    all_chunks = []
    for clause in clauses:
        all_chunks.extend(split_clause_to_chunks(clause))
    clause_chunk_count = len(all_chunks)
    print(f"   {clause_chunk_count} clause chunks (max {MAX_CHUNK_CHARS} chars each)")

    # Build table chunks
    print(f"\nBuilding table chunks...")
    table_chunk_count = load_tables(data, all_chunks)
    print(f"   {table_chunk_count} table chunks added")

    # Build figure chunks
    print(f"\nBuilding figure chunks...")
    if os.path.exists(pdf_path):
        figure_chunk_count = load_figures(data, all_chunks, pdf_path)
    else:
        print(f"   WARNING: PDF not found at {pdf_path} — skipping figures")
        figure_chunk_count = load_figures(data, all_chunks, pdf_path)  # will still build fallback chunks
    print(f"   {figure_chunk_count} figure chunks added")

    print(f"\n   Total chunks: {len(all_chunks)}")

    if dry_run:
        print("\nDRY RUN — stopping before embed/insert")
        return

    # Embed (with disk cache so crashes don't cost credits)
    cache_path = json_path.replace(".json", ".embeddings.json")
    if os.path.exists(cache_path):
        print(f"\nLoading cached embeddings from {cache_path}")
        with open(cache_path) as f:
            cached = json.load(f)
        if len(cached) == len(all_chunks):
            for chunk, vec in zip(all_chunks, cached):
                chunk["embedding"] = vec
        else:
            print(f"   Cache has {len(cached)} entries but we have {len(all_chunks)} chunks — regenerating")
            print(f"\nGenerating embeddings ({EMBED_MODEL})...")
            all_chunks = embed_in_batches(all_chunks)
            with open(cache_path, "w") as f:
                json.dump([c["embedding"] for c in all_chunks], f)
            print(f"   Embeddings cached -> {cache_path}")
    else:
        print(f"\nGenerating embeddings ({EMBED_MODEL})...")
        all_chunks = embed_in_batches(all_chunks)
        with open(cache_path, "w") as f:
            json.dump([c["embedding"] for c in all_chunks], f)
        print(f"   Embeddings cached -> {cache_path}")

    # Insert
    print(f"\nInserting into Supabase...")
    insert_chunks(all_chunks, standard_id, user_id)

    # Update standards record
    supabase.table("standards").update({
        "extraction_status": "complete",
        "total_chunks": len(all_chunks),
        "indexed_chunks": len(all_chunks),
    }).eq("id", standard_id).execute()

    print(f"\n{'=' * 60}")
    print(f"Done!")
    print(f"   Standard ID:    {standard_id}")
    print(f"   Clause chunks:  {clause_chunk_count}")
    print(f"   Table chunks:   {table_chunk_count}")
    print(f"   Figure chunks:  {figure_chunk_count}")
    print(f"   Total loaded:   {len(all_chunks)}")
    print(f"   Ready to query in StandAId")


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", default="as-nzs-3000-2018.json")
    parser.add_argument("--email", default="kyledixonelectrical@gmail.com")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load(args.json, args.email, args.dry_run)
