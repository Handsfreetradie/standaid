# Brief for Murfett Legal — reference content in StandAId

**From:** Kyle Dixon, StandAId
**Date:** 12 September 2026
**Re:** Three questions about reference content we serve to users — (1) National Construction Code text in an AI system, (2) plain-English summaries of AS/NZS 3000 clauses, (3) the same for AS/NZS 3500

## Background — what StandAId is

StandAId is a subscription app for Australian tradies. A user uploads a standard they have purchased (PDF), the app indexes it privately to that user, and they can search it and ask questions in plain English; answers cite the clause and open the page in their own PDF. Content a user uploads is never shared with or searchable by any other user. Our Terms of Service already make the user responsible for holding a licence that permits AI processing of anything they upload (Standards Australia's terms do not, and we say so in the ToS and at sign-up). That per-user model is **not** what this brief is about.

This brief is about **content we intend to supply ourselves, once, to every account** — no upload, no per-user licence. Three separate items, each with its own owner and legal basis; we would like each answered on its own footing.

## Question 1 — NCC 2025 text in the app (built; live now under CC BY 4.0)

**What we've done.** The National Construction Code 2025 (Volumes One, Two, Three, the ABCB Housing Provisions Standard and the Livable Housing Design Standard) is published by the Australian Building Codes Board under a Creative Commons Attribution 4.0 International licence. The copyright notice in the ABCB's own XML dataset states the licence and its exclusions verbatim: *"licensed under a Creative Commons Attribution 4.0 International licence, with the exception of: any third party material, any trade marks, and any images or photographs."* The required attribution is: *"The National Construction Code 2025 was provided by the Australian Building Codes Board under the CC BY 4.0 licence."*

We have taken the ABCB's XML dataset, extracted the **text** of every clause and table, and stored it once in a shared index that every account can search and ask questions of. Specifically:

- Text clauses and tables: stored and searchable by all users. Each answer that draws on NCC text shows a distinct "NCC" citation with the clause number and a link to that clause on **ncc.abcb.gov.au**, plus the attribution line above.
- **Images, diagrams and photographs: not stored or displayed at all.** Where a clause refers to a figure, we show the figure's number and title and link the user to the ABCB's web page for that clause, where they view the figure on the ABCB's own site.
- State and territory variations are stored as separate entries tagged by state and only shown to users in that state or who ask about it.
- The attribution line appears under every NCC-sourced answer, in the Terms of Service, and on the Profile page. The ToS also states StandAId is independent and not endorsed by the ABCB, and our marketing guideline is never to imply an ABCB partnership.

**Attachments (available on request):** the ABCB copyright/licence page from the dataset; a one-page diagram of the shared-index architecture (single shared table separate from per-user tables; read-only to users; served only with attribution).

**Questions.**
1a. Does our use — storing NCC text, embedding it for search, and having an AI model generate answers that quote and cite it, all with attribution and a link back — sit within CC BY 4.0 as you read it? Is there anything in the ABCB's own terms of use for ncc.abcb.gov.au (as opposed to the CC licence) that constrains this?
1b. Are we right that tables (which are text) are inside the licence, while figures/diagrams/photographs are excluded and must stay out?
1c. Is our attribution treatment sufficient (per-answer line, ToS section, Profile page), and is the "independent / not endorsed" statement worded strongly enough?
1d. Anything you'd want changed about linking users to ncc.abcb.gov.au (deep links to clause anchors)?

## Question 2 — plain-English summaries of selected AS/NZS 3000 clauses (built; **not live** pending your advice)

**Scope — deliberately narrow.** This is **not** a question about ingesting AS/NZS 3000. We are not proposing to store, reproduce or index any part of the standard for shared use. The question is about **our own original writing**: roughly 15–20 short entries, each a plain-English restatement of *what the rule is* for a topic tradies look up constantly (RCD protection, bathroom zones, earthing and the MEN link, voltage drop, cable protection, switchboard access, pre-energisation tests, and so on).

**How each entry is written.**
- Each entry starts from "what is the rule" and is written in our own words — drafted in-house, then reviewed and edited by a licensed electrician (Kyle) before it can be published. No sentence of the standard is copied or closely paraphrased, and nothing is published until that review is done.
- No table or figure is reproduced. Where a value matters (e.g. "30 mA"), it is restated as a plain fact, not by reproducing the table it sits in. In the current drafts, most numeric values are deliberately **omitted** and the tradie is pointed to the clause.
- The standard is cited by **clause number only** — e.g. "AS/NZS 3000 clause 2.6.3.2.2" — never by quoting clause text.
- Every entry carries a "source notes" record: which clause it summarises and how the wording was derived, kept as a paper trail of independent authorship.
- In the app, each entry is visually distinct from both the NCC citations and the user's own uploaded standards: a "Guide" chip, and the disclaimer *"Simplified summary — always verify against the current clause of the standard."* on every appearance.
- If the user has uploaded their own copy of AS/NZS 3000, the real clause is shown instead and the summary is suppressed.

**Attachment (available on request):** the draft entries with their source notes (a JSON file; ~19 entries).

**Questions.**
2a. Does original, plain-English restatement of a rule, citing the standard by clause number only and reproducing no text, tables or figures, infringe Standards Australia's copyright in AS/NZS 3000 in your view? Does the number of entries (15–20 of roughly 900 clauses) or their selection change the analysis?
2b. Is there a line we should stay on the right side of regarding restating numeric values (e.g. "30 mA", "5% voltage drop") as facts?
2c. Standards Australia's licence terms (which the user, not StandAId, accepts on purchase) restrict AI/ML use of *their content*. We are not using their content — we are writing our own. Do you see any way those terms reach StandAId here?
2d. Is the disclaimer and visual treatment adequate, and should the entries carry any additional statement (e.g. "not affiliated with or endorsed by Standards Australia")?
2e. Trade-mark: is referring to "AS/NZS 3000" by name in the citation acceptable as nominative use?

## Question 3 — the same for AS/NZS 3500 (plumbing) — **not yet written**

Same approach and same questions as Question 2, for the AS/NZS 3500 series (3500.1 water services, 3500.2 sanitary plumbing and drainage, 3500.3 stormwater, 3500.4 heated water services, 3500.5 domestic installations). Same owner (Standards Australia, jointly with Standards New Zealand). The content would be written with a licensed plumber's input. We'd like to know whether your answer to Question 2 transfers directly, or whether anything about the 3500 series (joint AS/NZS publication, referenced from NCC Volume Three as a deemed-to-satisfy document) changes it.

## What we need from you

- A view on each of 1, 2 and 3 separately, so we can ship the NCC work (already live under CC BY) without waiting on the standards questions, and hold the AS/NZS summaries dark until you've advised.
- Any wording changes to the ToS section and disclaimers.
- If either 2 or 3 is a "no", whether a narrower version (e.g. topic headings + clause numbers only, no rule text) would be acceptable.

*Prepared with the help of StandAId's engineering assistant; factual statements about what the software does have been checked against the code as built on 12 September 2026.*
