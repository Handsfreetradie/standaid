# NCC content in StandAId — licence compliance review

**Date:** 12 September 2026 · **Scope:** the shared NCC 2025 index (chat, audit "why this matters", ToS/Profile attribution) as deployed on `main`. Prepared before any marketing of the feature. This is a compliance check against primary sources, not legal advice — the open items are in the Murfett brief.

## 1. What licence actually applies

| Source | What it says |
|---|---|
| Copyright page inside every NCC 2025 XML publication (Vol 1, Vol 2, Vol 3, Housing Provisions, Livable Housing) | "licensed under a Creative Commons Attribution 4.0 International licence, with the exception of: any third party material, any trade marks, and any images or photographs." Required attribution: *"The National Construction Code 2025 was provided by the Australian Building Codes Board under the CC BY 4.0 licence."* © Commonwealth of Australia and the States and Territories of Australia 2026. |
| data.gov.au / researchdata.edu.au record for the NCC 2025 dataset | Licence: **CC BY 4.0** (link to creativecommons.org/licenses/by/4.0). Publisher: ABCB via data.gov.au. |
| ABCB "General NCC" FAQ (written for NCC 2022, same licence) | "NCC 2022 may be used to train artificial intelligence (AI) systems under the terms of … CC-BY-4.0." Conditions: attribute the ABCB; "not imply endorsement by the ABCB of any AI system or its outputs"; third-party content in the NCC "is not reused without separate permission". XML published "to support … apps, AI training, searchable databases". |
| ABCB copyright page | ABCB uses **three** CC variants (BY-NC-ND, BY-ND, BY) depending on the publication — the NCC itself is CC BY. Excluded everywhere: ABCB trade marks and logos (ABCB, NCC logo, WaterMark, CodeMark — written permission required), third-party content, anything marked otherwise. Framing prohibited; links "must fairly represent ABCB's role and not imply endorsement". |
| ABCB disclaimer | Not professional advice; no warranty as to accuracy/currency/completeness; users to seek independent advice. |

**Conclusion:** storing NCC text, embedding it for search and generating AI answers from it, commercially, is expressly within what the ABCB says the licence permits. The obligations are attribution (per CC BY §3(a)), no implied endorsement, no trade marks/logos, and no third-party material or images.

## 2. CC BY 4.0 §3(a) attribution checklist vs StandAId

| §3(a) requires | StandAId (after this review) |
|---|---|
| Identify the creator | ✅ "provided by the Australian Building Codes Board" on every NCC answer, in the ToS and on Profile |
| Copyright notice | ✅ "© Commonwealth of Australia and the States and Territories of Australia 2026, published by the ABCB" — chat attribution + ToS §3A (**added in this review**) |
| Notice referring to the licence + link/text | ✅ "CC BY 4.0" with hyperlink to creativecommons.org/licenses/by/4.0 on chat, ToS, Profile, audit panel (**link added in this review**) |
| Notice referring to the disclaimer of warranties | ✅ ToS §3A and chat line state the ABCB's disclaimer (no warranty, not professional advice) (**added**) |
| URI/hyperlink to the licensed material | ✅ every NCC chip links to the clause on ncc.abcb.gov.au (state variations link to the state schedule page) |
| Indicate if you modified the material | ✅ "NCC text has been extracted and reformatted, and this answer is an AI-generated summary of it — not the NCC itself" (**added**) |
| Reasonable manner for the medium | ✅ per-answer footer + standing ToS section |
| §2(a)(6) no endorsement | ✅ ToS: "independent … not published, endorsed, sponsored or approved by the ABCB"; Profile line; marketing rule below |
| §2(b)(2) trade marks not licensed | ✅ no ABCB/NCC logos used; "NCC" appears as plain text describing the source (nominative). Do not stylise it as a logo. *Open:* confirm registration status of the word marks with IP Australia (Murfett Q1e below). |

## 3. Exclusions — what we keep out

- **Images / photographs / diagrams:** never stored or displayed. Figure numbers and titles are shown with a link to the ABCB page. ✅
- **Third-party material:** scanned all 11,722 XML files and the 3,456 ingested rows for attribution language ("reproduced with permission", "© Standards Australia", "adapted from", "courtesy of", etc.). Nothing found in the volumes or Housing Provisions. **One hit:** the Livable Housing Design Standard states it "has been adapted from the 'Silver' level requirements of the Livable Housing Design Guidelines (LHDG), fourth edition, 2017" (Livable Housing Australia). The ABCB licenses its adaptation under CC BY, but this is the third-party-origin case the ABCB warns about. **Action taken: the 16 Livable Housing clauses are held back (`is_live=false`) until legal confirms.** The Livable Housing chip/link and ToS mention were removed from the live description.
- **Trade marks / logos:** none used. ✅

## 4. Currency — a real gap

Our ingest used dataset **v1.0 (published 5–6 May 2026)**. The ABCB released **v1.1 (22 June 2026)** and **v1.2 (26 June 2026)** with errata corrections (e.g. B1V1(5)(b), J6D5(3)(a)) and asked anyone who "accessed the dataset since May 6, 2026 … [to] download the latest version … and replace any previously saved or integrated data." Not a licence breach, but the ABCB disclaimer ("may not be complete or up-to-date") and our own ToS make currency our problem once we promote the feature.

**Action:** re-ingest from v1.2 (`scripts/ingest-ncc.py` — note the v1.1+ format consolidates each volume into a single document, so the parser needs adapting), and state the dataset version in the ToS. Until then, marketing copy must not claim "current" or "up to date".

## 5. Marketing rules (Australian Consumer Law + licence)

- Say **"the text of the NCC 2025"** — not "the whole NCC" (images excluded, Livable held back).
- Say **"free — 3 questions a day"**; don't say "free" without the limit.
- Never: "official", "approved", "endorsed", "in partnership with the ABCB", any ABCB/NCC logo, or design that mimics ncc.abcb.gov.au. "Independent" is a feature.
- Every ad/post that shows NCC text carries the one-line attribution.
- Keep "reference aid — verify on site / not professional advice" in tone; it's what the ToS and the ABCB's own disclaimer say.
- Do **not** market the AS/NZS clause guides (dark, pending Murfett) or lean on "upload AS/NZS standards for AI" — Standards Australia's terms make that the user's risk under our ToS; promote NCC + the user's *own* documents generally.

## 6. Open items for Murfett (added to the brief)

1e. Trade-mark status of "NCC" / "National Construction Code" word marks and whether a plain-text "NCC" badge is nominative use.
1f. Livable Housing Design Standard — adapted from a third-party guideline; can we serve the ABCB's CC BY adaptation, or must we get Livable Housing Australia's permission?
1g. Confirm our §3(a) attribution set is adequate for an AI chat medium (per-answer footer + ToS).

## Sources
- NCC 2025 XML dataset, "Copyright, Licence Notice and Acknowledgment of Country" page (all five publications)
- ABCB — Copyright: https://www.abcb.gov.au/copyright
- ABCB — Disclaimer: https://www.abcb.gov.au/disclaimer
- ABCB — General NCC FAQ (AI training, XML data): https://www.abcb.gov.au/faq/general-ncc
- NCC — Copyright FAQ: https://ncc.abcb.gov.au/faq/copyright
- NCC news — Updated NCC 2025 dataset (v1.2, 26 June 2026): https://ncc.abcb.gov.au/news/2026/updated-ncc-2025-dataset
- Dataset record (v1.1, CC BY 4.0): https://researchdata.edu.au/national-construction-code-version-11/4050522
- Creative Commons BY 4.0 legal code: https://creativecommons.org/licenses/by/4.0/legalcode
