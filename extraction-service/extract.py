#!/usr/bin/env python3
"""
StandAId — Claude-powered standard extraction.

Usage:
    python extract.py <standard_id>

The standard must already be uploaded via the app (so it exists in the
standards table and the PDF is in Supabase storage). This script replaces
the auto-extracted chunks with high-quality Claude-extracted ones.

Setup (one time):
    pip install -r requirements.txt
    cp .env.example .env   # then fill in your keys
"""

import sys
import os
import time
import textwrap
import httpx
from dotenv import load_dotenv
from supabase import create_client
import anthropic

import extractor

load_dotenv()


def main():
    if len(sys.argv) != 2:
        print("Usage: python extract.py <standard_id>")
        print("\nFind the standard_id in the Supabase dashboard → standards table,")
        print("or from the app URL after uploading a standard.")
        sys.exit(1)

    standard_id = sys.argv[1].strip()

    # ── Environment ───────────────────────────────────────────────────────────
    supabase_url = os.environ.get("SUPABASE_URL")
    supabase_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    missing = [k for k, v in [
        ("SUPABASE_URL", supabase_url),
        ("SUPABASE_SERVICE_ROLE_KEY", supabase_key),
        ("ANTHROPIC_API_KEY", anthropic_key),
    ] if not v]

    if missing:
        print(f"Missing environment variables: {', '.join(missing)}")
        print("Copy .env.example to .env and fill in your keys.")
        sys.exit(1)

    supabase = create_client(supabase_url, supabase_key)
    claude   = anthropic.Anthropic(api_key=anthropic_key)

    # ── Load standard record ──────────────────────────────────────────────────
    print(f"\nLoading standard {standard_id}...")
    result = supabase.table("standards").select("*").eq("id", standard_id).execute()
    if not result.data:
        print(f"Standard not found: {standard_id}")
        sys.exit(1)

    standard  = result.data[0]
    user_id   = standard["user_id"]
    std_code  = standard.get("standard_code") or "Unknown"
    version   = standard.get("version") or ""
    file_path = standard.get("file_path")
    title     = standard.get("title") or std_code

    print(f"  Title:    {title}")
    print(f"  Standard: {std_code} {version}")
    print(f"  User:     {user_id}")

    if not file_path:
        print("No file_path on this standard — was the PDF uploaded?")
        sys.exit(1)

    # ── Mark job as processing ────────────────────────────────────────────────
    supabase.table("processing_jobs").update({
        "status": "processing",
        "started_at": "now()",
    }).eq("standard_id", standard_id).in_("status", ["pending", "complete", "failed"]).execute()

    supabase.table("standards").update({
        "extraction_status": "processing",
    }).eq("id", standard_id).execute()

    # ── Download PDF ──────────────────────────────────────────────────────────
    print(f"\nDownloading PDF from storage...")
    try:
        pdf_bytes = bytes(supabase.storage.from_("standards").download(file_path))
        print(f"  {round(len(pdf_bytes) / 1024 / 1024, 1)} MB downloaded")
    except Exception as e:
        _fail(supabase, standard_id, f"Failed to download PDF: {e}")
        sys.exit(1)

    # ── Run extraction ────────────────────────────────────────────────────────
    print()
    start_time = time.time()

    def log(msg, **kwargs):
        print(msg, **kwargs)

    try:
        summary = extractor.run(
            standard_id=standard_id,
            user_id=user_id,
            standard_code=std_code,
            version=version,
            pdf_bytes=pdf_bytes,
            supabase=supabase,
            claude=claude,
            log=log,
        )
    except Exception as e:
        _fail(supabase, standard_id, str(e))
        print(f"\nExtraction failed: {e}")
        sys.exit(1)

    elapsed = round(time.time() - start_time)
    mins, secs = divmod(elapsed, 60)

    # ── Trigger embeddings ────────────────────────────────────────────────────
    print("\nTriggering embedding pipeline...")
    try:
        embed_url = f"{supabase_url}/functions/v1/embed-chunks"
        with httpx.Client() as http:
            resp = http.post(
                embed_url,
                json={"standard_id": standard_id, "user_id": user_id},
                headers={
                    "Authorization": f"Bearer {supabase_key}",
                    "Content-Type": "application/json",
                },
                timeout=30,
            )
        if resp.status_code < 300:
            print("  Embedding started (runs in background, takes ~2 min)")
        else:
            print(f"  Warning: embed-chunks returned {resp.status_code} — trigger manually if needed")
    except Exception as e:
        print(f"  Warning: could not trigger embed-chunks: {e}")
        print("  You can trigger it manually from the Supabase dashboard.")

    # ── Done ──────────────────────────────────────────────────────────────────
    print(f"""
╔══════════════════════════════════════════════╗
║  Extraction complete in {mins}m {secs:02d}s               ║
╠══════════════════════════════════════════════╣
║  Clauses : {str(summary['clauses']).ljust(34)} ║
║  Tables  : {str(summary['tables']).ljust(34)} ║
║  Figures : {str(summary['figures']).ljust(34)} ║
║  Chunks  : {str(summary['total_chunks']).ljust(34)} ║
╚══════════════════════════════════════════════╝

Embeddings are being generated in the background.
The standard will be fully searchable in ~2 minutes.
""")


def _fail(supabase, standard_id: str, message: str) -> None:
    supabase.table("processing_jobs").update({
        "status": "failed",
        "error_message": message,
        "completed_at": "now()",
    }).eq("standard_id", standard_id).execute()
    supabase.table("standards").update({
        "extraction_status": "failed",
    }).eq("id", standard_id).execute()


if __name__ == "__main__":
    main()
