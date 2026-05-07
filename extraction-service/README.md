# StandAId — Claude Extraction Pipeline

Replaces the auto-extracted chunks with high-quality Claude-extracted ones.
Run this locally after a user uploads a standard via the app.

## Setup (one time)

```bash
cd extraction-service

# Create virtual environment
python3 -m venv venv
source venv/bin/activate      # Mac/Linux
# venv\Scripts\activate       # Windows

# Install dependencies
pip install -r requirements.txt

# Set up environment
cp .env.example .env
# Edit .env and add your Anthropic API key + Supabase service role key
```

## Find the standard_id

1. User uploads their standard via the app as normal
2. Go to your Supabase dashboard → Table Editor → `standards` table
3. Copy the `id` (UUID) of the standard you want to re-extract

## Run extraction

```bash
python extract.py <standard_id>
```

Example:
```bash
python extract.py a1b2c3d4-e5f6-7890-abcd-ef1234567890
```

## What it does

1. Downloads the PDF from Supabase storage
2. Extracts text page by page with pdfplumber
3. Sends batches of 15 pages to Claude for intelligent extraction
4. Claude returns exact clause numbers, titles, and complete content
5. Replaces the existing auto-extracted chunks in the database
6. Triggers the embedding pipeline (runs in background, ~2 min)

The standard is fully searchable in the app once embeddings finish.

## Expected output

```
Loading standard a1b2c3d4...
  Title:    Electrical Installations (Wiring Rules)
  Standard: AS/NZS 3000 2018
  User:     user-uuid

Downloading PDF from storage...
  12.4 MB downloaded

Reading PDF pages...
  611 pages found
  Digital PDF confirmed (598/611 pages with text)

Extracting with Claude (41 batches of 15 pages)...
  Batch 1/41 (pages 1–15)... 12 clauses, 0 tables, 0 figures
  Batch 2/41 (pages 16–30)... 18 clauses, 2 tables, 1 figures
  ...

  Extracted: 847 clauses, 43 tables, 61 figures

Building chunks...
  952 chunks ready

Saving to database...
  952 chunks saved

Triggering embedding pipeline...
  Embedding started (runs in background, takes ~2 min)

╔══════════════════════════════════════════════╗
║  Extraction complete in 8m 23s               ║
╠══════════════════════════════════════════════╣
║  Clauses : 847                               ║
║  Tables  : 43                                ║
║  Figures : 61                                ║
║  Chunks  : 952                               ║
╚══════════════════════════════════════════════╝
```

## Cost estimate

AS/NZS 3000 (611 pages) using claude-haiku-4-5: ~$0.80–$1.20 per run.
