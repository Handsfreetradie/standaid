#!/usr/bin/env python3
"""
StandAId — NCC 2025 ingest (shared index, migration 20260912000000_ncc_shared_index.sql)

Reads the ABCB's official NCC 2025 XML dataset (data.gov.au, v1.2 — one
contents.xml per publication) and turns it into rows for public.ncc_chunks.
No PDF, no OCR, no vision model — every clause number, title, subclause,
list item, building-class facet, state variation, table and figure is already
tagged in the XML, so the only spend is OpenAI embeddings (~$0.015 for the
whole code, done server-side by the embed-ncc function).

What goes where
  - clause text            -> chunk_type 'text',  is_live true
  - state variations       -> separate rows tagged state='WA' etc. (clause-level,
                              subclause-level and table variations)
  - tables (HTML <table>)  -> chunk_type 'table', live (CC BY covers the text;
                              only images/photographs are outside the licence)
  - figures/images         -> never stored. The licence excludes images. We keep
                              the figure number + title in figure_refs and a
                              link to the clause on ncc.abcb.gov.au instead.
  - Schedule 1 definitions -> chunk_type 'glossary' under the Definitions row
  - Livable Housing        -> ingested but held dark (adapted from a third-party
                              guideline — see the legal review)

Source: unzip each ncc-2025-<pub>-v1.2.zip from
https://data.gov.au/data/dataset/national-construction-code-2025-version-1-2
into NCC_SOURCE_DIR/<zip name without -v1.2.zip>/contents.xml.

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

EDITION = "ncc_2025_v1_2"     # dataset v1.2 (data.gov.au, released 2026-06-18); bump per dataset release
SOURCE_DIR = os.environ.get("NCC_SOURCE_DIR", "/Users/kyledixon/Documents/Standards & References/NCC-2025-v1.2")
OUT_DIR = os.environ.get("NCC_OUT_DIR", "/tmp/ncc-ingest")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wyxeqkgpwkcckyntqcns.supabase.co")
EMBED_PRICE_PER_M = 0.02  # USD per 1M tokens
WEB_BASE = "https://ncc.abcb.gov.au/editions/ncc-2025/adopted"

# folder -> (publication key, standards.id from the migration, web slug or None)
PUBLICATIONS = {
    "ncc-2025-volume-one":             ("vol1",    "a0000000-0000-4000-8000-00000000cc01", "volume-one"),
    "ncc-2025-volume-two":             ("vol2",    "a0000000-0000-4000-8000-00000000cc02", "volume-two"),
    "ncc-2025-volume-three":           ("vol3",    "a0000000-0000-4000-8000-00000000cc03", "volume-three"),
    "ncc-2025-housing-provisions":     ("housing", "a0000000-0000-4000-8000-00000000cc04", "housing-provisions"),
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
CALLOUT_LABEL = {
    "info": "Explanatory information", "notes": "Note", "limitation": "Limitation",
    "application": "Application", "exemption": "Exemption",
}
MAX_CHUNK_CHARS = 2200   # split a clause body longer than this
TARGET_CHUNK_CHARS = 1800
MAX_EMBED_CHARS = 24000  # ~6k tokens, well under the 8191 limit

# ── xml helpers ─────────────────────────────────────────────────────────────
# Dataset v1.1+ format: ONE contents.xml per publication (ncc-volume /
# ncc-standard), everything inline — no conrefs. Hierarchy is
#   ncc-section[type=section|other|schedule, num] > part[num] | specification[num]
#     > (subtopic | spec-topic)? > clause[id, building] > subclause[num, state] > content
# State variations are inline: <clause-variation state=… type=REPLACE|INSERT>
# (under a part = a whole clause for that state; under a clause = replaces
# that clause), <subclause-variation state=…> under a clause/subclause, and
# <table-reference-variation state=…>. Schedules (state sections) only hold
# <variation> pointers to those ids, so they are skipped. Tables are HTML
# (table/thead/tbody/tr/th/td), cross-refs are <a>, callouts carry
# callout-type, MathML is inline. The Livable Housing Design Standard uses
# <standard-clause> instead of <clause>.

def local(tag):
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""

def child_text(el, name):
    c = next((c for c in el if local(c.tag) == name), None)
    return clean(inline(c)) if c is not None else ""

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

SKIP_INLINE = {"image-reference", "table-reference", "table-reference-variation", "clause-variation",
               "subclause-variation", "img", "col"}

def inline(el):
    """Flatten an element to a single line of text (inline context)."""
    if el is None:
        return ""
    t = local(el.tag)
    if t in SKIP_INLINE:
        return el.tail or ""
    if t in ("mathML", "math", "equation-inline", "equation-block"):
        return " " + math_text(el) + " " + (el.tail or "")
    out = [el.text or ""]
    for c in el:
        out.append(inline(c))
    out.append(el.tail or "")
    return "".join(out)

def list_label(depth, cls, i):
    if cls == "numbered":
        return f"({i})"
    if cls == "lower-roman" or (cls != "alpha" and depth == 1):
        return f"({roman(i)})"
    if cls == "alpha" or depth == 0:
        return f"({chr(ord('a') + i - 1) if i <= 26 else i})"
    return f"({chr(ord('A') + i - 1) if i <= 26 else i})"

def roman(n):
    vals = [(10, "x"), (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]
    s = ""
    for v, r in vals:
        while n >= v:
            s += r; n -= v
    return s

# ── block rendering ─────────────────────────────────────────────────────────

CALLOUT_LABEL.update({"explanatory": "Explanatory information", "information": "Explanatory information"})

class Rendered:
    def __init__(self):
        self.lines = []        # text lines of the clause body
        self.tables = []       # [(num, title, text, xml_id, state)]
        self.figures = []      # [(num, title)]

def render_list(el, depth, r, indent):
    cls = el.get("class", "")
    i = 0
    for li in el:
        if local(li.tag) != "li":
            continue
        i += 1
        label = list_label(depth, cls, i) if local(el.tag) == "ol" else "•"
        head = [li.text or ""]
        nested = []
        for c in li:
            ct = local(c.tag)
            if ct in ("ol", "ul"):
                nested.append(c); head.append(c.tail or "")
            elif ct in ("table-reference", "table-reference-variation", "image-reference", "callout"):
                render_block(c, r, indent + "  "); head.append(c.tail or "")
            else:
                head.append(inline(c))
        r.lines.append(f"{indent}{label} {clean(''.join(head))}")
        for n in nested:
            render_list(n, depth + 1, r, indent + "  ")

def render_table(tref, r, indent=""):
    num = tref.get("num") or child_text(tref, "num")
    title = child_text(tref, "title")
    state = tref.get("state") or None
    table = next((c for c in tref if local(c.tag) == "table"), None)
    label = f"[See Table {num}{' — ' + title if title else ''}{' (' + state + ' variation)' if state else ''}]"
    r.lines.append(indent + label)
    if table is None:
        return
    rows = []
    for tr in table.iter():
        if local(tr.tag) == "tr":
            cells = [clean(inline(c)) for c in tr if local(c.tag) in ("td", "th")]
            rows.append(" | ".join(cells))
    notes = [clean(inline(dn)) for dn in tref.iter() if local(dn.tag) == "desc-note"]
    text = "\n".join(rows)
    if notes:
        text += "\n" + "\n".join(f"Note: {n}" for n in notes)
    r.tables.append((num, title, text, tref.get("id"), state))

def render_block(el, r, indent=""):
    t = local(el.tag)
    if t in ("sptc", "title", "num", "img", "col", "clause-variation"):
        return
    if t in ("subclause", "subclause-variation"):
        num = el.get("num") or ""
        first = True
        for c in el:
            ct = local(c.tag)
            if ct in ("title", "num", "subclause-variation"):
                continue
            if ct == "content":
                parts = []
                for cc in c:
                    cct = local(cc.tag)
                    if cct == "num":
                        continue
                    if cct == "p":
                        parts.append(clean(inline(cc)))
                    elif cct in ("ol", "ul"):
                        r.lines.append(f"{indent}({num}) {' '.join(parts)}".rstrip() if first else f"{indent}{' '.join(parts)}".rstrip())
                        first = False; parts = []
                        render_list(cc, 0, r, indent + "  ")
                    else:
                        if parts:
                            r.lines.append(f"{indent}({num}) {' '.join(parts)}" if first else indent + " ".join(parts)); first = False; parts = []
                        render_block(cc, r, indent + "  ")
                if parts:
                    r.lines.append(f"{indent}({num}) {' '.join(parts)}" if first else indent + " ".join(parts)); first = False
            else:
                render_block(c, r, indent + "  ")
        return
    if t == "p":
        s_ = clean(inline(el))
        if s_:
            r.lines.append(indent + s_)
        return
    if t in ("h2", "h3", "h4"):
        s_ = clean(inline(el))
        if s_:
            r.lines.append(indent + s_ + ":")
        return
    if t in ("ol", "ul"):
        render_list(el, 0, r, indent); return
    if t == "callout":
        label = CALLOUT_LABEL.get(el.get("callout-type", ""), "Note")
        body = Rendered()
        for c in el:
            render_block(c, body, "")
        r.tables.extend(body.tables); r.figures.extend(body.figures)
        if body.lines:
            r.lines.append(f"{indent}{label}: " + " ".join(body.lines))
        return
    if t in ("table-reference", "table-reference-variation"):
        render_table(el, r, indent); return
    if t == "image-reference":
        num = el.get("num") or child_text(el, "num"); title = child_text(el, "title")
        if num or title:
            r.figures.append((num, title))
            r.lines.append(f"{indent}[See Figure {num}{' — ' + title if title else ''}]")
        return
    if t in ("equation-block",):
        r.lines.append(indent + math_text(el)); return
    # content, section, desc-note, glossdef, page and anything unknown: descend
    for c in el:
        render_block(c, r, indent)

def excluded_classes(el):
    """building="Class 1a,Class 1b,…" lists the classes a clause is HIDDEN for
    (Volume One clauses carry the Class 1/10 set). Inverted into "applies to";
    no attribute = unknown."""
    raw = el.get("building") or ""
    if not raw:
        return []
    excl = {x.strip().replace("Class ", "") for x in raw.split(",") if x.strip()}
    return [c for c in ALL_CLASSES if c not in excl]

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

# ── publication walk (v1.2 single document) ────────────────────────────────

def ancestors(el, parent):
    while el is not None:
        yield el
        el = parent.get(el)

def context_for(el, parent):
    """section/part/spec context for URL + header from the element's ancestors."""
    ctx = {}
    for a in ancestors(el, parent):
        t = local(a.tag)
        if t in ("part", "specification") and "part_num" not in ctx:
            ctx["kind"] = t
            ctx["part_num"] = a.get("num") or child_text(a, "num")
            ctx["part_title"] = child_text(a, "title")
        elif t == "ncc-section" and "section_num" not in ctx:
            n = a.get("num") or ""
            ctx["section_num"] = f"Section {n}" if a.get("type") == "section" else n
            ctx["section_title"] = child_text(a, "title")
    return ctx

def make_chunks(*, pub, standard_id, pub_slug, xml_id, sptc, title, body_r, state, ctx, facets, stats, chunks, prefix_note=None):
    # composite ids ("<clause id>:NSW") anchor to the clause itself
    url = clause_url(pub_slug, ctx, xml_id.split(":")[0], state)
    part_num, part_title = ctx.get("part_num", ""), ctx.get("part_title", "")
    header = f"{PUB_LABEL[pub]}" + (f", {'Specification' if ctx.get('kind') == 'specification' else 'Part'} {part_num} {part_title}" if part_num else "")
    if state:
        header += f" — {state} variation"
    head_line = f"{sptc} {title}".strip()
    figure_refs = []
    seen_f = set()
    for num, ftitle in body_r.figures:
        k = norm_num(num) or ftitle
        if k in seen_f: continue
        seen_f.add(k); figure_refs.append({"number": norm_num(num), "title": ftitle, "url": url})
    body_lines = ([prefix_note] if prefix_note else []) + list(body_r.lines)
    if not body_lines and not sptc:
        stats["empty"] += 1; return
    for i, g in enumerate(split_body(body_lines)):
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
    for (tn, tt, ttxt, tid, tstate) in body_r.tables:
        st = tstate or state
        turl = clause_url(pub_slug, ctx, xml_id.split(":")[0], st)
        content = f"{header if not tstate else header + (' — ' + tstate + ' variation' if not state else '')}\n{head_line}\nTable {tn}{' — ' + tt if tt else ''}\n\n{ttxt}"[:MAX_EMBED_CHARS]
        chunks.append({
            "standard_id": standard_id, "edition": EDITION, "publication": pub, "xml_id": tid or f"{xml_id}:tbl{tn}",
            "clause_number": sptc or None, "clause_title": f"Table {tn}" + (f" — {tt}" if tt else ""),
            "part_number": part_num or None, "part_title": part_title or None,
            "content": content, "chunk_index": 0, "chunk_type": "table", "state": st,
            "building_classes": facets, "figure_refs": [], "source_url": turl,
            "content_hash": hashlib.sha256(content.encode()).hexdigest(),
            "is_live": True, "needs_legal_review": False,
        })
        stats["table"] += 1

def render_clause_body(clause, include_state=None):
    """National body = subclauses with state="" (variations skipped). With
    include_state, only that state's clause/subclause variations are rendered."""
    r = Rendered()
    for c in clause:
        t = local(c.tag)
        if t in ("sptc", "title"):
            continue
        if include_state is None:
            if t in ("clause-variation", "subclause-variation"):
                continue
            if t == "subclause" and (c.get("state") or ""):
                continue
            render_block(c, r, "")
        else:
            if t == "subclause-variation" and c.get("state") == include_state:
                vt = (c.get("type") or "varies").lower()
                r.lines.append(f"[{include_state} variation — {vt}s subclause ({c.get('num', '')})]")
                render_block(c, r, "")   # renders its content like a subclause
            elif t == "subclause":
                for sv in c:
                    if local(sv.tag) == "subclause-variation" and sv.get("state") == include_state:
                        vt = (sv.get("type") or "varies").lower()
                        r.lines.append(f"[{include_state} variation — {vt}s subclause ({sv.get('num', '')})]")
                        render_block(sv, r, "")
            elif t == "table-reference-variation" and c.get("state") == include_state:
                render_table(c, r, "")
    return r

def build_publication(folder, pub, standard_id, pub_slug):
    path = os.path.join(SOURCE_DIR, folder, "contents.xml")
    root = ET.parse(path).getroot()
    parent = {c: p for p in root.iter() for c in p}
    chunks, stats = [], Counter()
    glossary = list(root.iter("glossentry"))

    for clause in list(root.iter("clause")) + list(root.iter("standard-clause")):
        # skip anything inside a state schedule (pointers only) or front matter
        if any(local(a.tag) == "ncc-section" and a.get("type") == "schedule" for a in ancestors(clause, parent)):
            continue
        ctx = context_for(clause, parent)
        sptc = child_text(clause, "sptc") or clause.get("sptc") or ""
        title = child_text(clause, "title")
        facets = excluded_classes(clause)
        xml_id = clause.get("id")
        # national text
        make_chunks(pub=pub, standard_id=standard_id, pub_slug=pub_slug, xml_id=xml_id, sptc=sptc, title=title,
                    body_r=render_clause_body(clause), state=None, ctx=ctx, facets=facets, stats=stats, chunks=chunks)
        # whole-clause state variations sitting inside this clause
        for cv in clause:
            if local(cv.tag) == "clause-variation" and cv.get("state"):
                st = cv.get("state"); vt = (cv.get("type") or "").upper()
                body = Rendered()
                for c in cv:
                    if local(c.tag) not in ("sptc", "title"):
                        render_block(c, body, "")
                make_chunks(pub=pub, standard_id=standard_id, pub_slug=pub_slug, xml_id=cv.get("id"), sptc=sptc,
                            title=child_text(cv, "title") or title, body_r=body, state=st, ctx=ctx,
                            facets=excluded_classes(cv) or facets, stats=stats, chunks=chunks,
                            prefix_note=f"[{st} variation — {vt.lower() or 'varies'}s clause {sptc} in {st}]")
                stats["state_clause"] += 1
        # subclause-level / table variations: one chunk per state
        states = {c.get("state") for c in clause.iter() if local(c.tag) in ("subclause-variation", "table-reference-variation") and c.get("state")}
        for st in sorted(states):
            body = render_clause_body(clause, include_state=st)
            if not body.lines and not body.tables:
                continue
            make_chunks(pub=pub, standard_id=standard_id, pub_slug=pub_slug, xml_id=f"{xml_id}:{st}", sptc=sptc, title=title,
                        body_r=body, state=st, ctx=ctx, facets=facets, stats=stats, chunks=chunks,
                        prefix_note=f"[{st} variation to clause {sptc} — read with the national clause]")
            stats["state_subclause"] += 1

    # whole new/replaced clauses for a state that sit directly under a part/spec
    for cv in root.iter("clause-variation"):
        if local(parent[cv].tag) not in ("part", "specification", "subtopic", "spec-topic"):
            continue
        if any(local(a.tag) == "ncc-section" and a.get("type") == "schedule" for a in ancestors(cv, parent)):
            continue
        st = cv.get("state"); sptc = cv.get("sptc") or child_text(cv, "sptc"); vt = (cv.get("type") or "").upper()
        body = Rendered()
        for c in cv:
            if local(c.tag) not in ("sptc", "title"):
                render_block(c, body, "")
        make_chunks(pub=pub, standard_id=standard_id, pub_slug=pub_slug, xml_id=cv.get("id"), sptc=sptc,
                    title=child_text(cv, "title"), body_r=body, state=st, ctx=context_for(cv, parent),
                    facets=excluded_classes(cv), stats=stats, chunks=chunks,
                    prefix_note=f"[{st} variation — {vt.lower() or 'varies'}s clause {sptc} in {st}]")
        stats["state_clause"] += 1

    return chunks, glossary, stats

def build_glossary(entries):
    chunks, seen = [], set()
    for g in entries:
        gid = g.get("id")
        if not gid or gid in seen:
            continue
        seen.add(gid)
        term = child_text(g, "glossterm")
        defs = []
        for d in g:
            if local(d.tag) == "glossdef":
                rr = Rendered(); render_block(d, rr, ""); defs.append(" ".join(rr.lines))
        body = " ".join(x for x in defs if x).strip()
        if not term or not body:
            continue
        cat = g.get("category") or "glossary"
        content = f"{PUB_LABEL['glossary']}\n{term}" + (f" ({cat})" if cat != "glossary" else "") + f"\n\n{body}"
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
