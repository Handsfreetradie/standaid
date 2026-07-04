# AS/NZS Standards Extraction Service

## Project Context

This service extracts Australian Standards PDFs with 100% accuracy for the StandAid app.
Tradies need to trust this data with their lives and livelihoods — no room for error.

**Parent Project:** StandAid (AI-powered standards access for Australian tradies)  
**Current Stack:** React + Vite (frontend, hosted on Vercel), Supabase (backend), OpenAI (embeddings)  
**This Service:** Standalone Python extraction → feeds validated JSON to Supabase  

---

## Mission

Build a production-grade Python service that extracts Australian Standards (AS/NZS) PDFs with 100% accuracy.

**What We're Building:**
1. Takes AS/NZS 3000:2018 PDF as input (611 pages)
2. Extracts every clause with exact numbers, titles, and content
3. Extracts every table with structured, searchable data
4. Catalogues every diagram/figure with page references
5. Validates clause numbering against PDF structure
6. Outputs clean, validated JSON ready for chunking and embedding

---

## Critical Requirements

### Accuracy (Non-Negotiable)
- Every clause number must be exact (3.6.2, not 3.6.Z or "approximately 3.6.2")
- Table data must be structured and searchable (not garbled text)
- Cross-references to other standards must be detected (AS/NZS 3008, NCC, etc.)
- No hallucinated clauses — if it's in the output, it's in the PDF

### Completeness
- Extract ALL clauses (definitions, requirements, notes, exceptions)
- Extract ALL tables with column headers and data
- Catalogue ALL figures/diagrams with captions and page numbers
- Handle nested clauses (2.10.4.3, 5.3.5.1.2, etc.)

### Performance
- No timeout limits (runs as long as needed)
- Progress reporting (so we know it's working on 611 pages)
- Resumable (if it crashes on page 400, can restart from there)

### Output Quality
- Valid JSON that can be version-controlled
- Human-readable structure for manual QA
- Metadata for cross-referencing (which clauses reference which tables)

---

## Technical Stack

**Required:**
- Python 3.11+
- Anthropic Claude API (for intelligent extraction)
- pdfplumber or PyPDF (for PDF reading and table detection)
- Standard library JSON (no fancy serializers)

**Do NOT use:**
- OpenAI API (we're using Claude for extraction)
- Complex frameworks (keep it simple and maintainable)
- Regex-only parsing (Claude should validate the structure)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Stage 1: PDF Inventory                                  │
│ → Load PDF, count pages, check structure                │
│ → Output: page count, detected sections                 │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 2: Page-by-Page Extraction (with Claude)          │
│ → For each page (or batch of pages):                    │
│   → Extract text + identify tables/figures              │
│   → Claude validates clause numbers and structure       │
│   → Build progressive JSON                              │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│ Stage 3: Validation & Assembly                          │
│ → Verify all clause numbers are sequential/valid        │
│ → Cross-reference tables to clauses                     │
│ → Detect standard references (AS/NZS 3008, etc.)        │
│ → Output final validated JSON                           │
└─────────────────────────────────────────────────────────┘
```

---

## Expected Output Format

```json
{
  "metadata": {
    "standard_code": "AS/NZS 3000",
    "version": "2018",
    "title": "Electrical Installations (known as the Australian/New Zealand Wiring Rules)",
    "total_pages": 611,
    "extraction_date": "2026-05-04T...",
    "extraction_quality": 98
  },
  "sections": [
    {
      "number": "SECTION 3",
      "title": "SELECTION AND INSTALLATION OF WIRING SYSTEMS",
      "page_start": 149,
      "page_end": 200
    }
  ],
  "clauses": [
    {
      "number": "3.6.2",
      "title": "Voltage drop",
      "content": "The voltage drop between the point of supply and...",
      "page": 152,
      "section": "SECTION 3",
      "references": {
        "tables": ["3.5"],
        "figures": [],
        "standards": ["AS/NZS 3008"],
        "other_clauses": ["3.6.1"]
      },
      "notes": ["NOTE: This is measured under normal operating conditions"],
      "exceptions": []
    }
  ],
  "tables": [
    {
      "number": "3.5",
      "title": "Maximum voltage drop",
      "page": 153,
      "referenced_by_clauses": ["3.6.2"],
      "columns": ["Circuit Type", "Maximum Voltage Drop (%)"],
      "data": [
        {"Circuit Type": "Final subcircuit", "Maximum Voltage Drop (%)": "5"},
        {"Circuit Type": "Submains", "Maximum Voltage Drop (%)": "5"}
      ],
      "searchable_text": "Table 3.5 Maximum Voltage Drop: Final subcircuit 5%, Submains 5%, combined maximum 5%"
    }
  ],
  "figures": [
    {
      "number": "3.2",
      "caption": "Multiple earthed neutral (MEN) system",
      "page": 145,
      "referenced_by_clauses": ["3.5.2"]
    }
  ],
  "cross_references": {
    "AS/NZS 3008": ["3.6.2", "4.2.1"],
    "AS/NZS 3000": ["internal references"],
    "NCC": ["2.5.3"]
  }
}
```

---

## Implementation Requirements

### 1. PDF Reading Strategy

**For text-based PDFs (digital, not scanned):**
- Use pdfplumber to extract text with layout preservation
- Extract tables using pdfplumber's table detection
- Pass text to Claude for clause identification and validation

**For scanned PDFs (if needed):**
- Use Claude's vision API with page images
- Claude extracts text + structure in one pass

**Decision logic:**
```python
def choose_extraction_method(pdf_path):
    sample_page = extract_sample_text(page=1)
    if len(sample_page.strip()) < 100:
        # Likely scanned - use Claude vision
        return "vision"
    else:
        # Digital PDF - use text extraction
        return "text"
```

### 2. Claude API Integration

**Prompt structure for clause extraction:**
```
You are extracting clauses from AS/NZS 3000:2018 - Australian Wiring Rules.

Page content:
[extracted text here]

Extract all clauses with their exact numbers, titles, and content.
Also identify any tables or figures on this page.

Output format:
{
  "clauses": [...],
  "tables": [...],
  "figures": [...]
}

CRITICAL: Clause numbers must be EXACT as they appear in the PDF.
Do not hallucinate or approximate. If unclear, flag for manual review.
```

**Validation prompt:**
```
Here are the extracted clauses from AS/NZS 3000:2018.

Validate:
1. Are clause numbers sequential and properly formatted?
2. Are there any gaps or duplicates?
3. Do table references match actual tables found?
4. Are cross-references to other standards detected?

Report any issues found.
```

### 3. Progress Reporting

```python
# Show progress as extraction runs
print(f"Processing page {page_num}/{total_pages} ({percentage}%)")
print(f"Extracted {len(clauses)} clauses so far")
print(f"Extracted {len(tables)} tables so far")

# Save checkpoints every 50 pages
if page_num % 50 == 0:
    save_checkpoint(f"checkpoint_page_{page_num}.json")
```

### 4. Error Handling

```python
# Retry logic for Claude API
max_retries = 3
for attempt in range(max_retries):
    try:
        response = call_claude_api(...)
        break
    except Exception as e:
        if attempt == max_retries - 1:
            log_error(f"Failed on page {page_num}: {e}")
            # Save partial results before crashing
            save_checkpoint(current_state)
            raise
        time.sleep(2 ** attempt)  # Exponential backoff
```

### 5. Quality Checks

Before outputting final JSON:
```python
def validate_extraction(data):
    """
    Run quality checks on extracted data.
    Returns dict of check results and overall quality score.
    """
    checks = {
        "all_clause_numbers_valid": validate_clause_numbers(data["clauses"]),
        "no_duplicate_clauses": check_duplicates(data["clauses"]),
        "tables_referenced_exist": validate_table_refs(data),
        "clause_sequence_logical": check_sequence(data["clauses"]),
        "cross_references_valid": validate_cross_refs(data),
    }
    
    quality_score = sum(checks.values()) / len(checks) * 100
    return checks, quality_score
```

---

## Testing Strategy

### Phase 1: Small Sample (Pages 149-153)
- Extract Section 3 opening + clause 3.6.2
- Verify clause numbers exact
- Verify Table 3.5 extracted with structure
- Manual comparison against PDF
- **Success criteria:** 100% accuracy on sample

### Phase 2: Full Section 3 (Pages 149-200)
- ~50 pages, representative content
- Contains tables, figures, nested clauses
- Validate extraction quality > 95%
- **Success criteria:** All clauses present, tables structured, no hallucinations

### Phase 3: Full Standard (611 pages)
- Run complete extraction
- Spot-check 20 random clauses manually
- Verify all tables catalogued
- Check cross-references detected
- **Success criteria:** Quality score > 95%, no critical errors

---

## Deliverables

1. **`extract_standard.py`** - Main extraction script
2. **`as-nzs-3000-2018.json`** - Validated output (from test run)
3. **`extraction_report.md`** - Quality metrics and issues found
4. **`requirements.txt`** - Python dependencies
5. **`README.md`** - How to run the extraction
6. **`config.example.env`** - Environment variables template

---

## Success Criteria

- [ ] Extracts all 611 pages without crashing
- [ ] Clause numbers 100% accurate (spot-check 50 random clauses)
- [ ] Tables extracted with searchable structure
- [ ] Figures catalogued with page references
- [ ] Cross-references to other standards detected
- [ ] Output JSON is valid and human-readable
- [ ] Extraction quality score > 95%
- [ ] Can be re-run on other AS/NZS standards (3008, 3012, etc.)
- [ ] No timeout issues (runs as long as needed)
- [ ] Checkpoint/resume functionality works

---

## Environment Setup

```bash
# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install dependencies
pip install anthropic pdfplumber python-dotenv

# Set API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Verify setup
python -c "import anthropic; print('Setup OK')"
```

---

## Run Command

```bash
# Full extraction
python extract_standard.py \
  --pdf AS_NZS_3000_2018.pdf \
  --output as-nzs-3000-2018.json \
  --progress

# Test on sample pages only
python extract_standard.py \
  --pdf AS_NZS_3000_2018.pdf \
  --output sample.json \
  --start-page 149 \
  --end-page 153 \
  --progress

# Resume from checkpoint
python extract_standard.py \
  --pdf AS_NZS_3000_2018.pdf \
  --output as-nzs-3000-2018.json \
  --resume checkpoint_page_400.json \
  --progress
```

---

## Integration with StandAid

Once extraction is validated:

1. **Upload validated JSON** to Supabase storage
2. **Modify `process-standard` edge function** to accept JSON input
3. **Chunking uses pre-validated data** (no regex, no OCR uncertainty)
4. **Table metadata** becomes searchable via embeddings
5. **Cross-references** enable multi-standard queries

**Future:** Run this extraction service for AS/NZS 3008, 3012, 3760, etc.

---

## Critical Reminders

1. **Accuracy over speed** — take as long as needed to get it right
2. **Validate everything** — don't trust regex or OCR blindly
3. **Save checkpoints** — 611 pages is long, crashes happen
4. **Human-readable output** — Kyle needs to QA this manually
5. **Reusable design** — this will process AS/NZS 3008, 3012, etc. later

Build this to the standard where you'd stake your professional reputation on the output.

---

## Communication Style

**Kyle's preferences (from userMemories):**
- Direct, outcome-focused
- Casual and conversational
- No jargon without explanation
- Practical analogies and examples
- Brief for simple questions, detailed for complex ones
- Australian English spelling and conventions

**When presenting results:**
- Show what works first
- Flag any issues clearly
- Don't bury important info in paragraphs
- Use bullet points and headers
- Short > long

---

**Ready to build. This is the production-ready extraction service StandAid needs.**
