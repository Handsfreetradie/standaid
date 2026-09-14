#!/usr/bin/env python3
"""
StandAId — build the public NCC explainer pages (SEO) from content/ncc-pages/topics.json

For every topic: our own intro + FAQ (topics.json), then the actual NCC 2025
clause text and tables pulled from public.ncc_chunks, each with a link to the
clause on ncc.abcb.gov.au, state-variation notes, the CC BY 4.0 attribution
block, JSON-LD (Article + FAQPage + BreadcrumbList), OpenGraph and a
canonical URL. Output is plain static HTML in public/ncc/<slug>/index.html —
Vercel serves files in public/ before the SPA rewrite, so these are real
crawlable pages with no JavaScript or login.

Also writes public/ncc/index.html (hub) and public/sitemap-ncc.xml.

  SUPABASE_SERVICE_ROLE_KEY=… python3 scripts/build-ncc-pages.py
"""
import html
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import date

ROOT = os.path.join(os.path.dirname(__file__), "..")
TOPICS = os.path.join(ROOT, "content", "ncc-pages", "topics.json")
OUT = os.path.join(ROOT, "public", "ncc")
SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://wyxeqkgpwkcckyntqcns.supabase.co")

ATTRIBUTION = "The National Construction Code 2025 was provided by the Australian Building Codes Board under the CC BY 4.0 licence."
COPYRIGHT = "© Commonwealth of Australia and the States and Territories of Australia 2026, published by the Australian Building Codes Board."
LICENCE_URL = "https://creativecommons.org/licenses/by/4.0/"
PUB_LABEL = {"vol1": "NCC 2025 Volume One", "vol2": "NCC 2025 Volume Two", "vol3": "NCC 2025 Volume Three", "housing": "NCC 2025 Housing Provisions", "livable": "NCC 2025 Livable Housing Design"}
STATE_NAME = {"WA": "Western Australia", "NSW": "New South Wales", "VIC": "Victoria", "QLD": "Queensland", "SA": "South Australia", "TAS": "Tasmania", "NT": "Northern Territory", "ACT": "Australian Capital Territory"}


def rest(path, key):
    req = urllib.request.Request(f"{SUPABASE_URL}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    return json.load(urllib.request.urlopen(req, timeout=60))


def fetch_clause(key, pub, clause, state=None):
    q = f"ncc_chunks?select=clause_number,clause_title,content,chunk_type,chunk_index,state,source_url,figure_refs,is_live&publication=eq.{pub}&clause_number=eq.{urllib.parse.quote(clause)}&order=chunk_type.desc,state.asc,chunk_index.asc"
    rows = rest(q, key)
    want = state or None
    text = [r for r in rows if r["chunk_type"] == "text" and (r["state"] or None) == want]
    tables = [r for r in rows if r["chunk_type"] == "table" and (r["state"] or None) == want]
    other_states = sorted({r["state"] for r in rows if r["state"] and r["state"] != want})
    if not text:
        raise SystemExit(f"clause not found: {pub} {clause} state={state}")
    if not all(r["is_live"] for r in text):
        raise SystemExit(f"clause is not live: {pub} {clause} state={state}")
    return text, tables, other_states


def body_of(content):
    # ingest prepends "<publication>, Part …\n<clause> <title>\n\n"
    return content.split("\n\n", 1)[1] if "\n\n" in content else content


def render_body(text_rows):
    """Clause body lines -> HTML paragraphs/lists, keeping the (1)/(a)/(i) labels as text."""
    lines = []
    for r in text_rows:
        lines.extend(body_of(r["content"]).split("\n"))
    out = []
    for ln in lines:
        s = ln.rstrip()
        if not s.strip():
            continue
        indent = (len(s) - len(s.lstrip(" "))) // 2
        s = html.escape(s.strip())
        if s.startswith("[See Figure") or s.startswith("[See Table"):
            out.append(f'<p class="ref" style="margin-left:{indent * 1.25}rem">{s}</p>')
        elif s.startswith("[") and "variation" in s:
            out.append(f'<p class="note">{s}</p>')
        else:
            out.append(f'<p style="margin-left:{indent * 1.25}rem">{s}</p>')
    return "\n".join(out)


def render_table(row):
    body = body_of(row["content"])
    lines = [l for l in body.split("\n") if l.strip()]
    notes = [l for l in lines if l.startswith("Note:")]
    rows = [l for l in lines if not l.startswith("Note:")]
    if not rows:
        return ""
    cells = [[html.escape(c.strip()) for c in r.split(" | ")] for r in rows]
    thead = "<tr>" + "".join(f"<th>{c}</th>" for c in cells[0]) + "</tr>"
    tbody = "".join("<tr>" + "".join(f"<td>{c}</td>" for c in r) + "</tr>" for r in cells[1:])
    cap = html.escape(row["clause_title"] or "Table")
    notes_html = "".join(f'<p class="note">{html.escape(n)}</p>' for n in notes)
    return f'<figure class="tbl"><figcaption>{cap}</figcaption><div class="scroll"><table><thead>{thead}</thead><tbody>{tbody}</tbody></table></div>{notes_html}</figure>'


def clause_section(key, spec):
    pub, clause, state = spec["publication"], spec["clause"], spec.get("state")
    text, tables, other_states = fetch_clause(key, pub, clause, state)
    first = text[0]
    title = html.escape(first["clause_title"] or "")
    url = first["source_url"]
    label = f"{PUB_LABEL[pub]}" + (f" — {STATE_NAME.get(state, state)} variation" if state else "")
    figs = first.get("figure_refs") or []
    fig_html = ""
    if figs:
        items = "".join(f'<li><a href="{html.escape(f["url"])}" rel="noopener" target="_blank">Figure {html.escape(f["number"])}{" — " + html.escape(f["title"]) if f.get("title") else ""}</a></li>' for f in figs)
        fig_html = f'<div class="figs"><p>Figures referenced (view on the ABCB site — images aren\'t reproduced here):</p><ul>{items}</ul></div>'
    var_html = ""
    if other_states and not state:
        names = ", ".join(STATE_NAME.get(s, s) for s in other_states)
        var_html = f'<p class="note">State variation: this clause is varied in {html.escape(names)}. Check the state schedule on the ABCB site, or set your state in StandAId to get the right version.</p>'
    tables_html = "\n".join(render_table(t) for t in tables)
    return f'''
<section class="clause" id="{html.escape(clause)}">
  <h2><span class="chip">NCC</span> {html.escape(clause)} — {title}</h2>
  <p class="meta">{html.escape(label)} · <a href="{html.escape(url)}" rel="noopener" target="_blank">Read this clause on ncc.abcb.gov.au ↗</a></p>
  {render_body(text)}
  {tables_html}
  {fig_html}
  {var_html}
</section>'''


CSS = """
:root{--red:#dc2626;--ink:#111827;--muted:#6b7280;--bg:#ffffff;--soft:#f9fafb;--line:#e5e7eb;--green:#047857}
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;color:var(--ink);background:var(--bg);line-height:1.55}
.wrap{max-width:760px;margin:0 auto;padding:1.25rem 1rem 4rem}
header.top{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding:.75rem 0;border-bottom:1px solid var(--line)}
.logo{font-weight:800;font-size:1.25rem;text-decoration:none;color:var(--ink)}.logo b{color:var(--red)}
.top a.cta,.cta-box a{display:inline-block;background:var(--red);color:#fff;text-decoration:none;font-weight:700;padding:.55rem .9rem;border-radius:999px;font-size:.9rem}
h1{font-size:1.75rem;line-height:1.2;margin:1.5rem 0 .5rem}h2{font-size:1.15rem;margin:2rem 0 .5rem;line-height:1.3}
.lede p{font-size:1.02rem}.crumbs{font-size:.8rem;color:var(--muted);margin-top:1rem}.crumbs a{color:var(--muted)}
.chip{display:inline-block;background:var(--green);color:#fff;font-size:.65rem;font-weight:800;letter-spacing:.04em;padding:.1rem .4rem;border-radius:4px;vertical-align:middle;margin-right:.25rem}
section.clause{border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;margin:1.25rem 0;background:var(--soft)}
section.clause h2{margin-top:0}section.clause p{margin:.35rem 0;font-size:.95rem}.meta{color:var(--muted);font-size:.85rem !important}.meta a{color:var(--green)}
.ref{color:var(--muted);font-style:italic}.note{background:#fffbeb;border-left:3px solid #f59e0b;padding:.4rem .6rem;border-radius:4px;font-size:.9rem !important}
.figs{margin-top:.6rem;font-size:.9rem}.figs ul{margin:.25rem 0 0 1.1rem;padding:0}.figs a{color:var(--green)}
figure.tbl{margin:.75rem 0}figure.tbl figcaption{font-weight:600;font-size:.9rem;margin-bottom:.35rem}.scroll{overflow-x:auto}
table{border-collapse:collapse;width:100%;font-size:.85rem;background:#fff}th,td{border:1px solid var(--line);padding:.35rem .5rem;text-align:left;vertical-align:top}th{background:#f3f4f6}
.faq details{border-bottom:1px solid var(--line);padding:.6rem 0}.faq summary{font-weight:600;cursor:pointer}.faq p{margin:.4rem 0 0}
.cta-box{background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:1rem 1.1rem;margin:2rem 0}.cta-box p{margin:0 0 .6rem}
.attrib{font-size:.78rem;color:var(--muted);border-top:1px solid var(--line);padding-top:1rem;margin-top:2rem}.attrib a{color:var(--muted)}
.related a{color:var(--red)}nav.related ul{padding-left:1.1rem}
.hub li{margin:.5rem 0}.hub a{font-weight:600;color:var(--ink)}.hub small{display:block;color:var(--muted)}
"""


def page_html(site, t, sections_html, today):
    base = site["base_url"]
    url = f"{base}/ncc/{t['slug']}/"
    faq = t.get("faq", [])
    faq_html = "".join(f'<details><summary>{html.escape(f["q"])}</summary><p>{html.escape(f["a"])}</p></details>' for f in faq)
    intro_html = "".join(f"<p>{html.escape(p)}</p>" for p in t["intro"])
    related = t.get("related", [])
    ld = [
        {"@context": "https://schema.org", "@type": "Article", "headline": t["title"], "description": t["description"], "datePublished": today, "dateModified": today,
         "author": {"@type": "Organization", "name": site["brand"]}, "publisher": {"@type": "Organization", "name": site["brand"]}, "mainEntityOfPage": url,
         "license": LICENCE_URL, "isBasedOn": "https://ncc.abcb.gov.au/editions/ncc-2025"},
        {"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": f["q"], "acceptedAnswer": {"@type": "Answer", "text": f["a"]}} for f in faq]},
        {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "StandAId", "item": base},
            {"@type": "ListItem", "position": 2, "name": "NCC explained", "item": f"{base}/ncc/"},
            {"@type": "ListItem", "position": 3, "name": t["h1"], "item": url}]},
    ]
    ld_html = "".join(f'<script type="application/ld+json">{json.dumps(x, ensure_ascii=False)}</script>' for x in ld)
    related_html = ""
    if related:
        related_html = '<nav class="related"><h2>Related</h2><ul>' + "".join(f'<li><a href="/ncc/{r}/">{html.escape(RELATED_TITLES.get(r, r))}</a></li>' for r in related) + "</ul></nav>"
    return f'''<!doctype html>
<html lang="en-AU">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{html.escape(t["title"])} | StandAId</title>
<meta name="description" content="{html.escape(t["description"])}">
<link rel="canonical" href="{url}">
<meta property="og:type" content="article"><meta property="og:title" content="{html.escape(t["title"])}"><meta property="og:description" content="{html.escape(t["description"])}"><meta property="og:url" content="{url}"><meta property="og:image" content="{base}/pwa-512.png">
<meta name="twitter:card" content="summary">
<link rel="icon" href="/favicon.ico">
{ld_html}
<style>{CSS}</style>
</head>
<body>
<div class="wrap">
<header class="top"><a class="logo" href="{base}/">Stand<b>AI</b>d</a><a class="cta" href="{html.escape(site["cta_url"])}">Ask the NCC — free</a></header>
<p class="crumbs"><a href="{base}/">StandAId</a> › <a href="/ncc/">NCC explained</a> › {html.escape(t["h1"])}</p>
<h1>{html.escape(t["h1"])}</h1>
<div class="lede">{intro_html}</div>
<p class="note">This page is a plain-English guide written by StandAId, followed by the actual NCC 2025 clause text. It is not professional advice and StandAId is not endorsed by the ABCB — always check the current edition on ncc.abcb.gov.au and your state's requirements.</p>
{sections_html}
<div class="cta-box"><p><strong>Got a follow-up?</strong> StandAId answers questions on the text of the NCC 2025 — Volumes One, Two, Three and the Housing Provisions — with the clause linked. Free account, 3 questions a day; upload your own standards for more.</p><a href="{html.escape(site["cta_url"])}">{html.escape(site["cta_text"])}</a></div>
<div class="faq"><h2>Common questions</h2>{faq_html}</div>
{related_html}
<div class="attrib">
<p>{html.escape(ATTRIBUTION)} {html.escape(COPYRIGHT)} Licence: <a href="{LICENCE_URL}" rel="license noopener" target="_blank">CC BY 4.0</a>. NCC text on this page was extracted from the ABCB's NCC 2025 dataset (v1.2) and reformatted; figures, diagrams and photographs are not reproduced (they are outside the licence) — follow the links to view them on the ABCB site. The ABCB publishes the NCC without warranty and it is not legal or professional advice.</p>
<p>StandAId is an independent product and is not published, endorsed, sponsored or approved by the Australian Building Codes Board, the Commonwealth, or any State or Territory. <a href="{base}/terms">Terms</a> · <a href="{base}/privacy">Privacy</a></p>
</div>
</div>
</body>
</html>'''


def hub_html(site, topics, today):
    base = site["base_url"]
    items = "".join(f'<li><a href="/ncc/{t["slug"]}/">{html.escape(t["h1"])}</a><small>{html.escape(t["description"])}</small></li>' for t in topics)
    return f'''<!doctype html>
<html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>NCC 2025 explained for tradies | StandAId</title>
<meta name="description" content="Plain-English guides to the National Construction Code 2025 for electricians, plumbers and builders — smoke alarms, wet areas, sheds and garages, hot water, stairs — with the actual clause text and links to the ABCB.">
<link rel="canonical" href="{base}/ncc/"><link rel="icon" href="/favicon.ico">
<meta property="og:type" content="website"><meta property="og:title" content="NCC 2025 explained for tradies"><meta property="og:url" content="{base}/ncc/"><meta property="og:image" content="{base}/pwa-512.png">
<style>{CSS}</style></head><body><div class="wrap">
<header class="top"><a class="logo" href="{base}/">Stand<b>AI</b>d</a><a class="cta" href="{html.escape(site["cta_url"])}">Ask the NCC — free</a></header>
<h1>NCC 2025, explained for tradies</h1>
<div class="lede"><p>Plain-English guides to the rules tradies look up most, each followed by the actual National Construction Code 2025 clause text with a link to the ABCB's site. Written by StandAId; not endorsed by the ABCB; not professional advice.</p></div>
<ul class="hub">{items}</ul>
<div class="cta-box"><p><strong>Need an answer for your job?</strong> StandAId answers questions on the text of the NCC 2025 with the clause linked, and knows your state's variations. Free account, 3 questions a day.</p><a href="{html.escape(site["cta_url"])}">{html.escape(site["cta_text"])}</a></div>
<div class="attrib"><p>{html.escape(ATTRIBUTION)} {html.escape(COPYRIGHT)} Licence: <a href="{LICENCE_URL}" rel="license noopener" target="_blank">CC BY 4.0</a>.</p><p>StandAId is independent and not endorsed by the Australian Building Codes Board. <a href="{base}/terms">Terms</a> · <a href="{base}/privacy">Privacy</a></p></div>
</div></body></html>'''


RELATED_TITLES = {}


def main():
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not key:
        raise SystemExit("needs SUPABASE_SERVICE_ROLE_KEY")
    doc = json.load(open(TOPICS, encoding="utf-8"))
    site, topics = doc["site"], doc["topics"]
    RELATED_TITLES.update({t["slug"]: t["h1"] for t in topics})
    today = date.today().isoformat()
    os.makedirs(OUT, exist_ok=True)
    urls = [f"{site['base_url']}/ncc/"]
    for t in topics:
        sections = "\n".join(clause_section(key, c) for c in t["clauses"])
        d = os.path.join(OUT, t["slug"]); os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "index.html"), "w", encoding="utf-8") as f:
            f.write(page_html(site, t, sections, today))
        urls.append(f"{site['base_url']}/ncc/{t['slug']}/")
        print(f"  built /ncc/{t['slug']}/  ({len(t['clauses'])} clauses)")
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8") as f:
        f.write(hub_html(site, topics, today))
    with open(os.path.join(ROOT, "public", "sitemap-ncc.xml"), "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
                "".join(f"  <url><loc>{u}</loc><lastmod>{today}</lastmod></url>\n" for u in urls) + "</urlset>\n")
    print(f"built hub + {len(topics)} pages + public/sitemap-ncc.xml")


if __name__ == "__main__":
    main()
