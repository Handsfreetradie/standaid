#!/usr/bin/env python3
"""
StandAId — seed clause guides (content/clause-guides/*.json -> public.clause_guides)

Guides are StandAId's own plain-English summaries of AS/NZS clauses (see the
migration 20260912020000_clause_guides.sql). This script upserts the CONTENT
columns only: is_live / reviewed_by / reviewed_at are never touched, so a
reviewed, live guide stays live when its wording is re-seeded, and a new guide
always lands dark (is_live=false) for SME + legal review.

Usage
  python3 scripts/seed-clause-guides.py                 # dry run: validate + summary
  python3 scripts/seed-clause-guides.py --apply         # upsert (needs SUPABASE_SERVICE_ROLE_KEY)
  then: POST embed-ncc with {"table":"clause_guides"} until remaining = 0
"""
import glob
import json
import os
import sys
import urllib.error
import urllib.request

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wyxeqkgpwkcckyntqcns.supabase.co")
CONTENT_DIR = os.path.join(os.path.dirname(__file__), "..", "content", "clause-guides")
REQUIRED = ("clause_ref", "topic", "title", "summary")


def load():
    rows, problems = [], []
    for path in sorted(glob.glob(os.path.join(CONTENT_DIR, "*.json"))):
        doc = json.load(open(path, encoding="utf-8"))
        for g in doc["guides"]:
            missing = [k for k in REQUIRED if not g.get(k)]
            if missing:
                problems.append(f"{os.path.basename(path)} {g.get('clause_ref')}: missing {missing}")
            if not g.get("source_notes"):
                problems.append(f"{os.path.basename(path)} {g.get('clause_ref')}: no source_notes (paper trail required)")
            rows.append({
                "standard_id": doc["standard_id"],
                "standard_code": doc["standard_code"],
                "trade": doc["trade"],
                "clause_ref": g["clause_ref"],
                "topic": g["topic"],
                "title": g["title"],
                "summary": g["summary"],
                "key_values": g.get("key_values", []),
                "related_ncc": g.get("related_ncc", []),
                "keywords": g.get("keywords", []),
                "source_notes": g.get("source_notes"),
            })
    return rows, problems


def upsert(rows, key):
    req = urllib.request.Request(
        f"{SUPABASE_URL}/rest/v1/clause_guides?on_conflict=standard_code,clause_ref",
        data=json.dumps(rows).encode(),
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
                 "Prefer": "resolution=merge-duplicates,return=minimal"},
        method="POST",
    )
    try:
        urllib.request.urlopen(req, timeout=60)
    except urllib.error.HTTPError as e:
        raise SystemExit(f"upsert failed ({e.code}): {e.read().decode()[:600]}")


def main():
    rows, problems = load()
    for p in problems:
        print("  !", p)
    by_std = {}
    for r in rows:
        by_std[r["standard_code"]] = by_std.get(r["standard_code"], 0) + 1
    print(f"{len(rows)} guides: {by_std}")
    if problems:
        raise SystemExit("fix the problems above first")
    if "--apply" not in sys.argv:
        print("DRY RUN — pass --apply to upsert")
        return
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise SystemExit("--apply needs SUPABASE_SERVICE_ROLE_KEY")
    upsert(rows, key)
    print(f"APPLY COMPLETE — {len(rows)} guides upserted (dark unless already reviewed). Now embed:")
    print('  curl -X POST "$SUPABASE_URL/functions/v1/embed-ncc" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d \'{"table":"clause_guides"}\'')


if __name__ == "__main__":
    main()
