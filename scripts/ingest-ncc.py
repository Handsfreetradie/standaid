#!/usr/bin/env python3
"""
StandAId — NCC 2025 ingest (shared index, migration 20260912000000_ncc_shared_index.sql)

Reads the ABCB's official NCC 2025 XML dataset (DITA-style, one folder per
publication) and turns it into rows for public.ncc_chunks. No PDF, no OCR, no
vision model — every clause number, title, subclause, list item, building-class
facet, state variation, table and figure is already tagged in the XML, so the
only spend is OpenAI embeddings (~$0.015 for the whole code, done server-side
by the embed-ncc function).

What goes where
  - clause text            -> chunk_type 'text',  is_live true
  - tables (CALS <table>)  -> chunk_type 'table', live (CC BY covers the text;
                              only images/photographs are outside the licence)
  - figures/images         -> never stored. The licence excludes images. We keep
                              the figure number + title in figure_refs and a
                              link to the clause on ncc.abcb.gov.au instead.
  - Schedule 1 definitions -> chunk_type 'glossary' under the Definitions row

Membership: each publication folder is a superset dump (Volume One's folder
contains Housing Provisions clause files too), so a clause belongs to a
publication only if that publication's FlattenedFile.xml conrefs it. State
variation files (…-WA.xml) are referenced the same way and carry state='WA'.

Usage
  python3 scripts/ingest-ncc.py                      # dry run: parse, stats, sample -> scratch JSON, no network
  python3 scripts/ingest-ncc.py --check-urls         # + GET-check a sample of generated ncc.abcb.gov.au links
  python3 scripts/ingest-ncc.py --offline            # skip the one-off link crawl (uses cached map if present)
  python3 scripts/ingest-ncc.py --apply              # upsert text rows (idempotent on edition/xml_id/chunk_index)
  then call the embed-ncc edge function until `remaining` is 0 (it holds the OpenAI key)

Env for --apply
  SUPABASE_SERVICE_ROLE_KEY    required
  SUPABASE_URL                 optional (defaults to the main project)
  NCC_SOURCE_DIR               optional (defaults to Kyle's local dataset folder)
  NCC_OUT_DIR                  optional (where the dry-run JSON goes)
"""

import hashlib
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict

# ── config ──────────────────────────────────────────────────────────────────

EDITION = "ncc_2025"
SOURCE_DIR = os.environ.get("NCC_SOURCE_DIR", "/Users/kyledixon/Documents/Standards & References/NCC")
OUT_DIR = os.environ.get("NCC_OUT_DIR", "/tmp/ncc-ingest")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wyxeqkgpwkcckyntqcns.supabase.co")
EMBED_PRICE_PER_M = 0.02  # USD per 1M tokens
WEB_BASE = "https://ncc.abcb.gov.au/editions/ncc-2025/adopted"

# folder -> (publication key, standards.id from the migration, web slug or None)
PUBLICATIONS = {
    "ncc-2025-volume-one":             ("vol1",    "a0000000-0000-4000-8000-00000000cc01", "volume-one"),
    "ncc-2025-volume-two":             ("vol2",    "a0000000-0000-4000-8000-00000000cc02", "volume-two"),
    "ncc-2025-volume-three":           ("vol3",    "a0000000-0000-4000-8000-00000000cc03", "volume-three"),
    "ncc-2025-abcb-housing-provisions":("housing", "a0000000-0000-4000-8000-00000000cc04", "housing-provisions"),
    "ncc-2025-livable-housing-design": ("livable", "a0000000-0000-4000-8000-00000000cc05", None),  # not on ncc.abcb.gov.au — see LIVABLE_URL
}
PUB_LABEL = {
    "vol1": "NCC 2025 Volume One", "vol2": "NCC 2025 Volume Two", "vol3": "NCC 2025 Volume Three",
    "housing": "NCC 2025 Housing Provisions", "livable": "NCC 2025 Livable Housing Design",
    "glossary": "NCC 2025 Schedule 1 Definitions",
}
GLOSSARY_STANDARD_ID = "a0000000-0000-4000-8000-00000000cc06"
# The Livable Housing Design Standard isn't published clause-by-clause on
# ncc.abcb.gov.au; link to ABCB's page for the standard itself.
LIVABLE_URL = "https://www.abcb.gov.au/resources/publications/abcb-livable-housing-design-standard"
GLOSSARY_SOURCE_FOLDER = "ncc-2025-volume-one"  # Schedule 1 is identical in every volume; ingest once

ALL_CLASSES = ("1a", "1b", "2", "3", "4", "5", "6", "7a", "7b", "8", "9a", "9b", "9c", "10a", "10b", "10c")
STATES = ("NT", "WA", "SA", "QLD", "VIC", "NSW", "TAS", "ACT")
STATE_RE = re.compile(r"-(NT|WA|SA|QLD|VIC|NSW|TAS|ACT)\.xml$")
CALLOUT_LABEL = {
    "info": "Explanatory information", "notes": "Note", "limitation": "Limitation",
    "application": "Application", "exemption": "Exemption",
}
MAX_CHUNK_CHARS = 2200   # split a clause body longer than this
TARGET_CHUNK_CHARS = 1800
MAX_EMBED_CHARS = 24000  # ~6k tokens, well under the 8191 limit

# ── xml helpers ─────────────────────────────────────────────────────────────

def local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""

def child_text(el, name):
    c = next((c for c in el if local(c.tag) == name), None)
    return inline(c).strip() if c is not None else ""

def clean(s):
    return re.sub(r"[ \t]+", " ", re.sub(r"\s*\n\s*", " ", s or "")).strip()

def math_text(el):
    """Linearise MathML into something readable: A_{1,2} , (a+b)/c, sqrt(x)."""
    t = local(el.tag)
    kids = list(el)
    if t in ("mi", "mo", "mn", "mtext"):
        return (el.text or "").strip()
    if t == "mfrac" and len(kids) == 2:
        return f"({math_text(kids[0])})/({math_text(kids[1])})"
    if t == "msub" and len(kids) == 2:
        return f"{math_text(kids[0])}_{{{math_text(kids[1])}}}"
    if t == "msup" and len(kids) == 2:
        return f"{math_text(kids[0])}^{{{math_text(kids[1])}}}"
    if t == "msubsup" and len(kids) == 3:
        return f"{math_text(kids[0])}_{{{math_text(kids[1])}}}^{{{math_text(kids[2])}}}"
    if t == "msqrt":
        return "sqrt(" + "".join(math_text(k) for k in kids) + ")"
    if t == "annotation":
        return ""
    return "".join(math_text(k) for k in kids)

def inline(el):
    """Flatten an element to a single line of text (inline context)."""
    if el is None:
        return ""
    t = local(el.tag)
    if t == "delText":            # track-changes deletion — not part of the published text
        return el.tail or ""
    if t in ("image-reference", "table-reference", "meta", "clause-variation", "specification-variation"):
        return el.tail or ""
    if t in ("mathML", "math", "equation-inline", "equation-block"):
        return " " + math_text(el) + " " + (el.tail or "")
    out = [el.text or ""]
    for c in el:
        out.append(inline(c))
    out.append(el.tail or "")
    return "".join(out)

def list_label(depth, outputclass, i):
    if outputclass == "numbered":
        return f"({i})"
    if outputclass == "alpha" or depth == 0:
        return f"({chr(ord('a') + i - 1) if i <= 26 else i})"
    if depth == 1:
        return f"({roman(i)})"
    return f"({chr(ord('A') + i - 1) if i <= 26 else i})"

def roman(n):
    vals = [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    s = ""
    for v, r in vals:
        while n >= v:
            s += r; n -= v
    return s

# ── block rendering ─────────────────────────────────────────────────────────

class Rendered:
    def __init__(self):
        self.lines = []        # text lines of the clause body
        self.tables = []       # [(num, title, text)] inline tables found
        self.figures = []      # [(num, title)] inline image refs found
        self.variations = []   # ["SA REPLACE", ...]

def render_list(el, depth, r, indent):
    oc = el.get("outputclass", "")
    i = 0
    for li in el:
        if local(li.tag) != "li":
            continue
        i += 1
        label = list_label(depth, oc, i) if local(el.tag) == "ol" else "•"
        # li text = own text + inline children, excluding nested lists/blocks
        head = [li.text or ""]
        nested = []
        for c in li:
            ct = local(c.tag)
            if ct in ("ol", "ul"):
                nested.append(c); head.append(c.tail or "")
            elif ct in ("p",):
                head.append(inline(c))
            elif ct in ("table-reference", "image-reference", "callout"):
                render_block(c, r, indent + "  ")
                head.append(c.tail or "")
            else:
                head.append(inline(c))
        r.lines.append(f"{indent}{label} {clean(''.join(head))}")
        for n in nested:
            render_list(n, depth + 1, r, indent + "  ")

def render_table(tref, r, fallback_num=""):
    num = child_text(tref, "num") or fallback_num
    title = child_text(tref, "title")
    table = next((c for c in tref if local(c.tag) == "table"), None)
    if table is None:
        r.lines.append(f"[See Table {num}{' — ' + title if title else ''}]")
        return
    rows = []
    for tg in table.iter():
        if local(tg.tag) == "row":
            cells = [clean(inline(e)) for e in tg if local(e.tag) == "entry"]
            rows.append(" | ".join(cells))
    notes = [clean(inline(dn)) for dn in tref.iter() if local(dn.tag) == "desc-note"]
    text = "\n".join(rows)
    if notes:
        text += "\n" + "\n".join(f"Note: {n}" for n in notes)
    r.tables.append((num, title, text))
    r.lines.append(f"[See Table {num}{' — ' + title if title else ''}]")

def render_block(el, r, indent=""):
    t = local(el.tag)
    if t in ("meta", "sptc", "title", "archive-num", "num"):
        return
    if t == "clause-variation" or t == "specification-variation":
        v = el.get("variation"); vt = el.get("variation-type", "")
        if v:
            r.variations.append(f"{v} {vt}".strip())
        return
    if t == "subclause":
        num = child_text(el, "num")
        if el.get("variation"):
            # <subclause outputclass="state-variation" variation="NSW" variation-type="REPLACE">
            # sits inline after the national subclause it replaces/inserts.
            vt = (el.get("variation-type") or "varies").lower()
            r.lines.append(f"{indent}[{el.get('variation')} variation — {vt}s subclause ({num}) below]")
        parts = []
        for c in el:
            ct = local(c.tag)
            if ct in ("title", "num"):
                continue
            if ct == "p":
                parts.append(clean(inline(c)))
            elif ct in ("ol", "ul"):
                if parts:
                    r.lines.append(f"{indent}({num}) {' '.join(parts)}"); parts = []
                    render_list(c, 0, r, indent + "  ")
                else:
                    r.lines.append(f"{indent}({num})"); render_list(c, 0, r, indent + "  ")
            else:
                render_block(c, r, indent + "  ")
        if parts:
            r.lines.append(f"{indent}({num}) {' '.join(parts)}")
        return
    if t == "p":
        s = clean(inline(el))
        if s:
            r.lines.append(indent + s)
        return
    if t in ("ol", "ul"):
        render_list(el, 0, r, indent); return
    if t == "callout":
        kind = next((c.get("ncc-info-type", "") for c in el if local(c.tag) == "callout-type"), "")
        label = CALLOUT_LABEL.get(kind, "Note")
        body = Rendered()
        for c in el:
            if local(c.tag) != "callout-type":
                render_block(c, body, "")
        if body.lines:
            r.lines.append(f"{indent}{label}: " + " ".join(body.lines))
        return
    if t == "table-reference":
        render_table(el, r); return
    if t == "image-reference":
        num = child_text(el, "num"); title = child_text(el, "title")
        if num or title:
            r.figures.append((num, title))
            r.lines.append(f"{indent}[See Figure {num}{' — ' + title if title else ''}]")
        return
    if t in ("equation-block",):
        r.lines.append(indent + math_text(el)); return
    if t in ("section", "intro-part", "glossBody", "desc-note"):
        for c in el:
            render_block(c, r, indent)
        return
    # unknown container: descend
    for c in el:
        render_block(c, r, indent)

# ── slugs / urls ────────────────────────────────────────────────────────────

def slug(s):
    s = (s or "").lower().replace("&", "and")
    s = re.sub(r"[^a-z0-9]+", "-", s)
    return s.strip("-")

URL_MAP = {}  # (pub_slug, kind, num) -> absolute page url; kind = 'part' | 'spec' | 'NSW' | 'WA' | ...

def crawl_url_map(cache_path):
    """ncc.abcb.gov.au slugs are Drupal pathauto (stopwords dropped, 100-char
    cap, specs as bare '12-fire-doors…'), so guessing them from titles fails
    ~40% of the time. Instead crawl each volume page -> section pages -> leaf
    links once (~50 GETs, public, no login) and cache the exact URLs."""
    global URL_MAP
    if os.path.isfile(cache_path):
        URL_MAP = {tuple(k.split("|")): v for k, v in json.load(open(cache_path)).items()}
        return
    ua = {"User-Agent": "Mozilla/5.0 (StandAId NCC ingest; link discovery)"}
    found = {}
    for pub_slug in ("volume-one", "volume-two", "volume-three", "housing-provisions"):
        try:
            _, html = http("GET", f"{WEB_BASE}/{pub_slug}", ua, timeout=60)
        except Exception as e:  # noqa: BLE001
            print(f"  ! crawl {pub_slug}: {e}", file=sys.stderr); continue
        pat = rf'href="(?:https://ncc\.abcb\.gov\.au)?(/editions/ncc-2025/adopted/{pub_slug}/[^"#/]+)"'
        for sec in sorted(set(re.findall(pat, html.decode("utf-8", "ignore")))):
            sec_name = sec.rsplit("/", 1)[1]
            try:
                _, sh = http("GET", "https://ncc.abcb.gov.au" + sec, ua, timeout=60)
            except Exception as e:  # noqa: BLE001
                print(f"  ! crawl {sec}: {e}", file=sys.stderr); continue
            leaves = set(re.findall(rf'href="(?:https://ncc\.abcb\.gov\.au)?({re.escape(sec)}/[^"#/]+)"', sh.decode("utf-8", "ignore")))
            for leaf in leaves:
                name = leaf.rsplit("/", 1)[1]
                url = "https://ncc.abcb.gov.au" + leaf
                m = re.match(r"^part-([a-z0-9]+)-", name)
                if m:
                    found.setdefault((pub_slug, "part", m.group(1)), url); continue
                m = re.match(r"^(nsw|vic|qld|sa|wa|tas|nt|act)-([a-z0-9]+)-", name)
                if m:
                    found.setdefault((pub_slug, m.group(1).upper(), m.group(2)), url); continue
                m = re.match(r"^(\d+)-", name)
                if m and re.match(r"^[a-j]-", sec_name):   # a spec under a lettered section
                    found.setdefault((pub_slug, "spec", m.group(1)), url)
            time.sleep(0.25)
    URL_MAP = found
    with open(cache_path, "w") as f:
        json.dump({"|".join(k): v for k, v in found.items()}, f, indent=1)
    print(f"  crawled {len(found)} part/spec pages -> {cache_path}")

def clause_url(pub_slug, ctx, xml_id, state=None):
    fallback = f"{WEB_BASE}/{pub_slug}" if pub_slug else LIVABLE_URL
    if not pub_slug or not ctx.get("part_num"):
        return fallback
    num = re.sub(r"[^a-z0-9]", "", ctx["part_num"].lower())
    kind = "spec" if ctx.get("kind") == "specification" else "part"
    page = (state and URL_MAP.get((pub_slug, state, num))) or URL_MAP.get((pub_slug, kind, num))
    return f"{page}#{xml_id}" if page else fallback

# ── flattened map walk ──────────────────────────────────────────────────────

def walk_map(el, ctx, refs, glossary):
    t = local(el.tag)
    if t == "topicset":
        ctx = {**ctx, "section_num": el.get("section-num", ""), "section_title": el.get("navtitle", "")}
    elif t == "part":
        ctx = {**ctx, "kind": "part", "part_num": child_text(el, "num"), "part_title": child_text(el, "title")}
    elif t == "specification":
        ctx = {**ctx, "kind": "specification", "part_num": child_text(el, "num"), "part_title": child_text(el, "title")}
    elif t == "clause" and el.get("conref"):
        refs.append((el.get("conref"), el.get("id"), dict(ctx)))
        return
    elif t == "abcb-glossentry":
        glossary.append(el)
        return
    for c in el:
        walk_map(c, ctx, refs, glossary)

# ── clause file -> chunks ───────────────────────────────────────────────────

def parse_clause_file(path):
    root = ET.parse(path).getroot()
    if local(root.tag) != "clause":
        # part/spec/other container referenced as a clause — render whatever is there
        pass
    # <facet building="Class 1a"/> lists the classes a clause is HIDDEN for (an
    # exclusion list — Volume One clauses carry Class 1a/1b/10a/10b/10c, which
    # Volume One doesn't cover). Invert it into "applies to". No facets = unknown.
    excluded = {f.get("building", "").replace("Class ", "") for f in root.iter() if local(f.tag) == "facet" and f.get("building")}
    facets = [c for c in ALL_CLASSES if c not in excluded] if excluded else []
    sptc = child_text(root, "sptc")
    title = child_text(root, "title")
    r = Rendered()
    for c in root:
        render_block(c, r, "")
    return root.get("id"), sptc, title, facets, r

def split_body(body_lines):
    """Group lines into chunks of ~TARGET_CHUNK_CHARS, breaking at subclause boundaries."""
    text = "\n".join(body_lines)
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    groups, cur, cur_len = [], [], 0
    for ln in body_lines:
        is_boundary = re.match(r"^\(\d+\)", ln) is not None
        if cur and cur_len + len(ln) > TARGET_CHUNK_CHARS and (is_boundary or cur_len > TARGET_CHUNK_CHARS):
            groups.append("\n".join(cur)); cur, cur_len = [], 0
        cur.append(ln); cur_len += len(ln) + 1
    if cur:
        groups.append("\n".join(cur))
    return groups

def norm_num(n):
    return re.sub(r"\s*\(.*?\)\s*:?\s*$", "", (n or "").strip()).rstrip(":").strip()

def base_clause(n):
    """'10.2.19b' -> '10.2.19', 'S23C7d' -> 'S23C7'."""
    return re.sub(r"[a-z]$", "", norm_num(n))

def load_number_index(xml_dir, prefix):
    """table-*.xml / image-*.xml -> {base clause number: [(num, title, root)]}"""
    idx = defaultdict(list)
    for fn in os.listdir(xml_dir):
        if not fn.startswith(prefix + "-") or not fn.endswith(".xml"):
            continue
        p = os.path.join(xml_dir, fn)
        if not os.path.isfile(p):
            continue
        try:
            root = ET.parse(p).getroot()
        except ET.ParseError:
            continue
        num = child_text(root, "num"); title = child_text(root, "title")
        st = STATE_RE.search(fn)
        idx[(base_clause(num), st.group(1) if st else None)].append((norm_num(num), title, root, fn))
    return idx

def build_publication(folder, pub, standard_id, pub_slug):
    xml_dir = os.path.join(SOURCE_DIR, folder, "XMLs")
    flat = ET.parse(os.path.join(xml_dir, "FlattenedFile.xml")).getroot()
    refs, glossary = [], []
    walk_map(flat, {}, refs, glossary)
    # State REPLACE variations (10-2-1-wet-areas-SA.xml) are only pointed at from
    # inside the national clause via an unresolvable internal path, never from the
    # map — so pull in any on-disk sibling named <clause>-<STATE>.xml. INSERT
    # variations are conref'd from the map directly and dedupe on xml_id.
    expanded = []
    for conref, map_id, ctx in refs:
        conref = conref.replace("ERROR_IN_RESOLVING_URI:", "")
        expanded.append((conref, map_id, ctx))
        if conref.endswith(".xml") and not STATE_RE.search(conref):
            for st in STATES:
                sib = f"{conref[:-4]}-{st}.xml"
                if os.path.isfile(os.path.join(xml_dir, sib)):
                    expanded.append((sib, None, ctx))
    refs = expanded

    tables_by_clause = load_number_index(xml_dir, "table")
    images_by_clause = load_number_index(xml_dir, "image")
    used_tables = set()

    chunks, seen, stats = [], set(), Counter()
    for conref, map_id, ctx in refs:
        path = os.path.join(xml_dir, conref)
        if not os.path.isfile(path):
            stats["missing_file"] += 1; continue
        try:
            xml_id, sptc, title, facets, r = parse_clause_file(path)
        except ET.ParseError as e:
            stats["parse_error"] += 1; print(f"  ! parse error {conref}: {e}", file=sys.stderr); continue
        xml_id = xml_id or map_id
        if xml_id in seen:
            stats["dup"] += 1; continue
        seen.add(xml_id)
        st = STATE_RE.search(conref)
        state = st.group(1) if st else None
        if not sptc and not r.lines:
            stats["empty"] += 1; continue

        url = clause_url(pub_slug, ctx, xml_id, state)
        part_num, part_title = ctx.get("part_num", ""), ctx.get("part_title", "")
        header = f"{PUB_LABEL[pub]}" + (f", {'Specification' if ctx.get('kind') == 'specification' else 'Part'} {part_num} {part_title}" if part_num else "")
        if state:
            header += f" — {state} variation"
        head_line = f"{sptc} {title}".strip()

        # figures: inline refs + files numbered off this clause
        figs = {}
        for num, ftitle in r.figures:
            if num: figs[norm_num(num)] = ftitle
        for num, ftitle, _root, _fn in images_by_clause.get((sptc, state), []) if sptc else []:
            figs.setdefault(num, ftitle)
        figure_refs = [{"number": n, "title": t, "url": url} for n, t in sorted(figs.items())]

        body_lines = list(r.lines)
        if r.variations:
            body_lines.append("State variation: " + "; ".join(f"{v} clause applies in that jurisdiction" for v in r.variations))
        groups = split_body(body_lines)
        for i, g in enumerate(groups):
            content = f"{header}\n{head_line}" + (" (cont.)" if i else "") + f"\n\n{g}"
            chunks.append({
                "standard_id": standard_id, "edition": EDITION, "publication": pub, "xml_id": xml_id,
                "clause_number": sptc or None, "clause_title": title or None,
                "part_number": part_num or None, "part_title": part_title or None,
                "content": content, "chunk_index": i, "chunk_type": "text", "state": state,
                "building_classes": facets, "figure_refs": figure_refs, "source_url": url,
                "content_hash": hashlib.sha256(content.encode()).hexdigest(),
                "is_live": True, "needs_legal_review": False,
            })
            stats["text"] += 1

        # tables: inline in the clause, plus files numbered off this clause
        table_items = [(n, t, txt, f"{xml_id}:tbl{k}") for k, (n, t, txt) in enumerate(r.tables)]
        for n, t, root, fn in tables_by_clause.get((sptc, state), []) if sptc else []:
            if fn in used_tables:
                continue
            used_tables.add(fn)
            rr = Rendered(); render_table(root, rr, n)
            for (tn, tt, ttxt) in rr.tables:
                table_items.append((tn, tt, ttxt, root.get("id") or fn))
        for k, (tn, tt, ttxt, tid) in enumerate(table_items):
            content = f"{header}\n{head_line}\nTable {tn}{' — ' + tt if tt else ''}\n\n{ttxt}"[:MAX_EMBED_CHARS]
            chunks.append({
                "standard_id": standard_id, "edition": EDITION, "publication": pub, "xml_id": tid,
                "clause_number": sptc or None, "clause_title": f"Table {tn}" + (f" — {tt}" if tt else ""),
                "part_number": part_num or None, "part_title": part_title or None,
                "content": content, "chunk_index": 0, "chunk_type": "table", "state": state,
                "building_classes": facets, "figure_refs": [], "source_url": url,
                "content_hash": hashlib.sha256(content.encode()).hexdigest(),
                "is_live": True, "needs_legal_review": False,
            })
            stats["table"] += 1

    # Table files that didn't map to a clause of this publication are skipped:
    # the folder is a superset dump, so they're almost all another
    # publication's tables (or front matter like "Table 1 List of amendments").
    stats["table_files_skipped"] = sum(len(v) for v in tables_by_clause.values()) - len(used_tables)
    return chunks, glossary, stats

def build_glossary(entries):
    chunks, seen = [], set()
    for g in entries:
        gid = g.get("id")
        if not gid or gid in seen:
            continue
        seen.add(gid)
        term = child_text(g, "glossterm")
        acr = " / ".join(clean(inline(c)) for c in g.iter() if local(c.tag) in ("glossAcronym", "glossAbbreviation", "glossAlt") and clean(inline(c)))
        defs = []
        for d in g:
            if local(d.tag) == "glossdef":
                rr = Rendered(); render_block(d, rr, ""); defs.append(" ".join(rr.lines))
        for d in g.iter():
            if local(d.tag) == "glossdef-variation" and d.get("variation"):
                rr = Rendered(); render_block(d, rr, "")
                if rr.lines: defs.append(f"[{d.get('variation')} variation: {' '.join(rr.lines)}]")
        body = " ".join(x for x in defs if x).strip()
        if not term or not body:
            continue
        content = f"{PUB_LABEL['glossary']}\n{term}" + (f" ({acr})" if acr else "") + f"\n\n{body}"
        chunks.append({
            "standard_id": GLOSSARY_STANDARD_ID, "edition": EDITION, "publication": "glossary", "xml_id": gid,
            "clause_number": "Schedule 1", "clause_title": term,
            "part_number": None, "part_title": None,
            "content": content, "chunk_index": 0, "chunk_type": "glossary", "state": None,
            "building_classes": [], "figure_refs": [],
            "source_url": f"{WEB_BASE}/volume-one/1-definitions",
            "content_hash": hashlib.sha256(content.encode()).hexdigest(),
            "is_live": True, "needs_legal_review": False,
        })
    return chunks

# ── network ─────────────────────────────────────────────────────────────────

def http(method, url, headers=None, body=None, timeout=120):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=body)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.status, resp.read()

def upsert(rows, key):
    # PostgREST merge-duplicates only touches columns present in the payload, so
    # an existing embedding survives a re-run of unchanged text. If content_hash
    # changes, the ncc_chunks_invalidate_embedding trigger nulls the embedding
    # so embed-ncc re-embeds that row.
    body = json.dumps(rows).encode()
    url = f"{SUPABASE_URL}/rest/v1/ncc_chunks?on_conflict=edition,xml_id,chunk_index"
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json",
               "Prefer": "resolution=merge-duplicates,return=minimal"}
    for attempt in range(4):
        try:
            http("POST", url, headers, body); return
        except urllib.error.HTTPError as e:
            msg = e.read().decode()[:600]
            if e.code >= 500 and attempt < 3:
                time.sleep(2 ** attempt); continue
            raise SystemExit(f"upsert failed ({e.code}): {msg}")

def check_urls(chunks, n=14):
    pool = [c for c in chunks if c["chunk_type"] == "text" and "#" in (c["source_url"] or "")]
    by_kind = defaultdict(list)
    for c in pool:
        kind = (c["publication"], "spec" if re.match(r"^S\d+C", c["clause_number"] or "") else "clause", bool(c["state"]))
        by_kind[kind].append(c)
    sample = []
    for kind, items in sorted(by_kind.items()):
        sample.extend(random.sample(items, min(2, len(items))))
    ok = bad = 0
    for c in sample[:n * 2]:
        url = c["source_url"].split("#")[0]
        try:
            status, _ = http("GET", url, {"User-Agent": "Mozilla/5.0 (StandAId ingest URL check)"}, timeout=30)
        except urllib.error.HTTPError as e:
            status = e.code
        except Exception as e:  # noqa: BLE001
            status = str(e)
        flag = "OK " if status == 200 else "BAD"
        if status == 200: ok += 1
        else: bad += 1
        print(f"  {flag} {status} {c['publication']:8} {c['clause_number'] or '':10} {c['state'] or '':3} {url}")
    print(f"  url check: {ok} ok, {bad} bad")

# ── main ────────────────────────────────────────────────────────────────────

def main():
    args = sys.argv[1:]
    apply = "--apply" in args
    do_check = "--check-urls" in args
    os.makedirs(OUT_DIR, exist_ok=True)

    all_chunks, glossary_entries = [], None
    print(f"source: {SOURCE_DIR}")
    url_cache = os.path.join(OUT_DIR, "ncc-url-map.json")
    if "--offline" in args and not os.path.isfile(url_cache):
        print("  ! --offline with no cached URL map: every source_url will be a landing page", file=sys.stderr)
    if "--offline" not in args or os.path.isfile(url_cache):
        crawl_url_map(url_cache)   # loads the cache when present; only crawls without one
    for folder, (pub, sid, pslug) in PUBLICATIONS.items():
        if not os.path.isdir(os.path.join(SOURCE_DIR, folder)):
            print(f"  ! missing folder {folder}", file=sys.stderr); continue
        chunks, glossary, stats = build_publication(folder, pub, sid, pslug)
        if folder == GLOSSARY_SOURCE_FOLDER:
            glossary_entries = glossary
        all_chunks.extend(chunks)
        print(f"  {pub:8} {dict(stats)}")
    if glossary_entries:
        g = build_glossary(glossary_entries)
        all_chunks.extend(g)
        print(f"  glossary {len(g)} terms")

    # The Livable Housing Design Standard states it was "adapted from the
    # Livable Housing Design Guidelines (2017)" — a third-party document. The
    # ABCB licenses its adaptation under CC BY, but "third party material" is
    # excluded from that licence, so it stays dark until legal confirms.
    for c in all_chunks:
        if c["publication"] == "livable":
            c["is_live"] = False; c["needs_legal_review"] = True

    # global dedupe on (xml_id, chunk_index) — a spec clause can be conref'd from two publications;
    # first publication wins (walk order above).
    seen, deduped = set(), []
    for c in all_chunks:
        k = (c["xml_id"], c["chunk_index"])
        if k in seen: continue
        seen.add(k); deduped.append(c)
    all_chunks = deduped

    chars = sum(len(c["content"]) for c in all_chunks)
    est_tokens = chars // 4
    by_type = Counter(c["chunk_type"] for c in all_chunks)
    by_state = Counter(c["state"] or "national" for c in all_chunks)
    live = sum(1 for c in all_chunks if c["is_live"])
    print(f"\nchunks: {len(all_chunks)}  by type: {dict(by_type)}  live: {live}")
    print(f"states: {dict(by_state)}")
    print(f"chars: {chars:,}  ~tokens: {est_tokens:,}  est. embedding cost: ${est_tokens / 1e6 * EMBED_PRICE_PER_M:.3f} USD")
    print(f"figure refs: {sum(len(c['figure_refs']) for c in all_chunks)}  clauses with figures: {sum(1 for c in all_chunks if c['figure_refs'])}")

    if not apply:
        sample_path = os.path.join(OUT_DIR, "ncc-chunks.json")
        with open(sample_path, "w") as f:
            json.dump(all_chunks, f, ensure_ascii=False, indent=1)
        print(f"\nDRY RUN — wrote {sample_path} (no network calls). Pass --apply to embed + upsert.")
        if do_check:
            print("\nchecking generated URLs (GET, no login):"); check_urls(all_chunks)
        return

    srk = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not srk:
        raise SystemExit("--apply needs SUPABASE_SERVICE_ROLE_KEY")

    # Rows go up WITHOUT embeddings; the embed-ncc edge function fills them in
    # server-side (that's where OPENAI_API_KEY lives). Re-running re-upserts the
    # text; an existing embedding is left alone unless the content changed.
    done = 0; t0 = time.time()
    BATCH = 200
    for i in range(0, len(all_chunks), BATCH):
        batch = all_chunks[i:i + BATCH]
        upsert(batch, srk)
        done += len(batch)
        if done % (BATCH * 5) == 0 or done == len(all_chunks):
            print(f"  {done}/{len(all_chunks)}  {time.time() - t0:.0f}s")
    print(f"\nAPPLY COMPLETE — {done} rows upserted. Now embed them server-side:")
    print('  curl -X POST "$SUPABASE_URL/functions/v1/embed-ncc" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d \'{}\'   # repeat until remaining = 0')

if __name__ == "__main__":
    main()
