# StandAId QA Test Report
**Date:** 2026-05-03T09:39:13.291Z
**Endpoint:** `https://wyxeqkgpwkcckyntqcns.supabase.co/functions/v1/query`
**Total Queries:** 50

## Summary

| Metric | Value |
|--------|-------|
| Total Queries | 50 |
| PASS | 9 (18.0%) |
| FAIL | 41 |
| NEEDS REVIEW | 0 |
| **Pass Rate** | **18.0%** |

## Failure Patterns

| Issue | Count |
|-------|-------|
| No clause citation | 23 |
| Missing ⚠️ on safety-critical topic | 5 |
| Hallucinated citations detected | 41 |
| Confidence score < 0.70 | 10 |
| API flagged needs_review | 41 |
| HTTP error (non-200) | 0 |

## Detailed Results

| # | Query | Response (first 100 chars) | Verdict | Confidence | Issues |
|---|-------|---------------------------|---------|------------|--------|
| 1 | What is the maximum allowable voltage drop for a final su... | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 2 | What is the maximum voltage drop from the point of supply... | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 3 | How do I size a cable for a 20A circuit with a 30 metre run? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 4 | What is the minimum cable size for a 10A general purpose ... | The extracts I have don't cover that specific question. Check the full standard or ask a more specif | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 5 | How do I derate cables installed in conduit? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 6 | Which circuits in a house require an RCD? | The extracts I have don't cover that specific question. Check the full standard or ask a more specif | ❌ FAIL | 0.60 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |
| 7 | What is the maximum tripping time for a 30mA RCD? | AS/NZS 3017 Clause 3.7.2.2 states that for a general RCD, the maximum tripping time is 300 ms with a | ✅ PASS | 1.00 | None |
| 8 | Do I need an RCD on a hot water circuit? | AS NZS 4777.2.2015 Clause 9.2.5 states that residual current devices (RCDs) are required for inverte | ✅ PASS | 1.00 | None |
| 9 | What is the minimum earth conductor size for a 20A circuit? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: Safety-critical query has no ⚠️ warning; FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 10 | What does AS/NZS 3000 say about main earthing conductor s... | The extracts I have don't cover that specific question. Check the full standard or ask a more specif | ❌ FAIL | 0.60 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |
| 11 | What is equipotential bonding and when is it required? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: Safety-critical query has no ⚠️ warning; FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 12 | What isolation requirements apply before working on a swi... | AS/NZS 3000 Clause 3.2.4 states that consumers mains must be de-energized and isolated before testin | ✅ PASS | 1.00 | None |
| 13 | What test voltage is used for insulation resistance testi... | AS/NZS 3000 Clause 3.2.1 states that insulation resistance tests should apply a direct current at 50 | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 14 | What is the minimum insulation resistance value for a new... | The minimum insulation resistance value for a new installation is not less than 1 MΩ, as stated in A | ✅ PASS | 1.00 | None |
| 15 | How do I verify a new installation meets wiring rules req... | AS/NZS 3017 Clause 1.1 states that electrical installations must be inspected and tested to ensure t | ✅ PASS | 1.00 | None |
| 16 | What are the clearance requirements inside a switchboard? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 17 | What is the maximum height for a switchboard main switch? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.60 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |
| 18 | What label must be attached to a main switchboard? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 19 | What protection is required for consumer mains? | AS/NZS 3000 Clause 2.2 outlines that consumer mains must have basic protection against direct contac | ✅ PASS | 1.00 | None |
| 20 | What is the maximum current rating for a sub-main without... | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 21 | What does AS/NZS 3000 say about overload protection for c... | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.60 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |
| 22 | What is the discrimination requirement between protective... | The extracts I have don't cover the specific discrimination requirements between protective devices. | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 23 | When can a circuit breaker be omitted at the origin of a ... | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 24 | What is the minimum number of power outlets required in a... | The extracts I have don't cover the minimum number of power outlets required in a bedroom. This info | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 25 | How close can a GPO be installed to a kitchen sink? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: Safety-critical query has no ⚠️ warning; FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 26 | What are the requirements for socket outlets in a bathroom? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: Safety-critical query has no ⚠️ warning; FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 27 | What is the maximum number of points on a lighting circuit? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 28 | Do LED downlights need to be in a fire-rated ceiling? | The extracts I have don't cover specific requirements for LED downlights in fire-rated ceilings. Thi | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 29 | Can I run TPS cable in a roof space without conduit? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 30 | What are the requirements for cables buried underground? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 31 | What depth must cables be buried under a concrete slab? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 32 | What protection is required for an air conditioning circuit? | The extracts I have don't cover specific protection requirements for air conditioning circuits. Gene | ❌ FAIL | 0.60 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |
| 33 | What is the demand factor for air conditioning loads? | The extracts I have don't cover the demand factor for air conditioning loads. That's typically addre | ❌ FAIL | 0.60 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |
| 34 | What information must be on circuit labels in a switchboard? | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 35 | Is a single-line diagram required for a domestic installa... | The extracts I have don't cover the specific requirement for a single-line diagram in domestic insta | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 36 | What tests are required during a verification of a new el... | The standard outlines several tests required to verify a new electrical installation, including eart | ✅ PASS | 1.00 | None |
| 37 | What is the continuity test requirement for protective co... | AS/NZS 3017 Clause 3.1.2 states that the resistance of protective earthing conductors must be low en | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 38 | What is the polarity test and why is it done? | The polarity test ensures that the active, neutral, and earthing conductors are correctly connected  | ❌ FAIL | 0.60 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |
| 39 | How often must portable appliances be tested in a workshop? | The extracts I have don't cover the specific frequency for testing portable appliances in a workshop | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 40 | What are the pass/fail criteria for in-service insulation... | The extracts I have don't cover the specific pass/fail criteria for in-service insulation resistance | ❌ FAIL | 0.60 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |
| 41 | What is the maximum loop impedance for a 20A Type C circu... | AS/NZS 3017 Clause 39 specifies that the maximum earth fault-loop impedance for a 20A Type C circuit | ✅ PASS | 1.00 | None |
| 42 | What is the prospective short circuit current requirement... | The extracts I have don't cover that specific question. Check the full standard or ask a more specif | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 43 | What is the maximum disconnection time for a 230V TN-S sy... | The extracts I have don't cover the specific question about the maximum disconnection time for a 230 | ❌ FAIL | 0.80 | FAIL: Safety-critical query has no ⚠️ warning; FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 44 | What are the AS/NZS 3000 requirements for isolating a sol... | The extracts I have don't cover the specific requirements for isolating a solar inverter according t | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 45 | What labelling is required on a solar installation at the... | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 46 | What classification system applies to hazardous areas for... | The extracts I have don't cover the specific classification system for hazardous areas for electrica | ❌ FAIL | 0.60 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |
| 47 | What circuit requirements apply to an electric hot water ... | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.80 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 48 | What is the minimum circuit size for an electric oven? | The extracts I have don't cover the specific minimum circuit size for an electric oven. This informa | ✅ PASS | 1.00 | None |
| 49 | What does the wiring rules say about working on live elec... | AS/NZS 3000 Clause 1.2 states that electrical testing inherently involves some degree of hazard, and | ❌ FAIL | 0.80 | FAIL: API flagged needs_review (possible hallucinated citation or low grounding) |
| 50 | What are the requirements for a safety observer when work... | This isn't covered in the sections I can see. Try rephrasing your question or check the full standar | ❌ FAIL | 0.60 | FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format); FAIL: API flagged needs_review (possible hallucinated citation or low grounding); FAIL: Confidence score 0.60 is below 0.70 threshold |

## Low Confidence Queries (< 0.70)

- **Q6:** "Which circuits in a house require an RCD?" — score: 0.60
- **Q10:** "What does AS/NZS 3000 say about main earthing conductor sizing?" — score: 0.60
- **Q17:** "What is the maximum height for a switchboard main switch?" — score: 0.60
- **Q21:** "What does AS/NZS 3000 say about overload protection for conductors?" — score: 0.60
- **Q32:** "What protection is required for an air conditioning circuit?" — score: 0.60
- **Q33:** "What is the demand factor for air conditioning loads?" — score: 0.60
- **Q38:** "What is the polarity test and why is it done?" — score: 0.60
- **Q40:** "What are the pass/fail criteria for in-service insulation resistance testing of a power tool?" — score: 0.60
- **Q46:** "What classification system applies to hazardous areas for electrical equipment?" — score: 0.60
- **Q50:** "What are the requirements for a safety observer when working on high voltage equipment?" — score: 0.60

## Failed Queries — Full Detail

### Q1: What is the maximum allowable voltage drop for a final sub-circuit?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q2: What is the maximum voltage drop from the point of supply to the point of use?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q3: How do I size a cable for a 20A circuit with a 30 metre run?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q4: What is the minimum cable size for a 10A general purpose outlet circuit?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
The extracts I have don't cover that specific question. Check the full standard or ask a more specific question about cable sizing or related topics.
```

### Q5: How do I derate cables installed in conduit?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q6: Which circuits in a house require an RCD?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
The extracts I have don't cover that specific question. Check the full standard or ask a more specific question about RCD requirements for particular circuits.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q9: What is the minimum earth conductor size for a 20A circuit?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: Safety-critical query has no ⚠️ warning
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q10: What does AS/NZS 3000 say about main earthing conductor sizing?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
The extracts I have don't cover that specific question. Check the full standard or ask a more specific question about earthing conductor sizing.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q11: What is equipotential bonding and when is it required?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: Safety-critical query has no ⚠️ warning
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q13: What test voltage is used for insulation resistance testing on a new installation?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
AS/NZS 3000 Clause 3.2.1 states that insulation resistance tests should apply a direct current at 500 V for most installations. For certain equipment that cannot be isolated, a lower voltage of 250 V is used.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q16: What are the clearance requirements inside a switchboard?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q17: What is the maximum height for a switchboard main switch?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q18: What label must be attached to a main switchboard?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q20: What is the maximum current rating for a sub-main without overcurrent protection at the source?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q21: What does AS/NZS 3000 say about overload protection for conductors?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q22: What is the discrimination requirement between protective devices?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
The extracts I have don't cover the specific discrimination requirements between protective devices. This topic is typically addressed in more detailed sections of the relevant standards. Check the full standard or ask a more specific question about protective devices.
```

### Q23: When can a circuit breaker be omitted at the origin of a sub-circuit?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q24: What is the minimum number of power outlets required in a bedroom?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
The extracts I have don't cover the minimum number of power outlets required in a bedroom. This information is typically found in building codes or specific electrical standards rather than the extracts provided. Check the full standard or relevant building regulations for that information.
```

### Q25: How close can a GPO be installed to a kitchen sink?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: Safety-critical query has no ⚠️ warning
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q26: What are the requirements for socket outlets in a bathroom?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: Safety-critical query has no ⚠️ warning
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q27: What is the maximum number of points on a lighting circuit?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q28: Do LED downlights need to be in a fire-rated ceiling?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
The extracts I have don't cover specific requirements for LED downlights in fire-rated ceilings. This topic is typically addressed in building codes and fire safety regulations rather than Australian Standards. Check the full standard or relevant building codes for detailed requirements.
```

### Q29: Can I run TPS cable in a roof space without conduit?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q30: What are the requirements for cables buried underground?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q31: What depth must cables be buried under a concrete slab?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q32: What protection is required for an air conditioning circuit?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
The extracts I have don't cover specific protection requirements for air conditioning circuits. Generally, protection for such circuits would involve ensuring proper circuit breakers, RCDs, and earthing as per relevant Australian Standards. You may want to check the full standard or ask a more specific question about electrical installations related to air conditioning.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q33: What is the demand factor for air conditioning loads?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
The extracts I have don't cover the demand factor for air conditioning loads. That's typically addressed in specific guidelines or standards related to HVAC systems rather than the provided Australian Standards.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q34: What information must be on circuit labels in a switchboard?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q35: Is a single-line diagram required for a domestic installation?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
The extracts I have don't cover the specific requirement for a single-line diagram in domestic installations. Check the full standard or ask a more specific question about electrical installation documentation.
```

### Q37: What is the continuity test requirement for protective conductors?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
AS/NZS 3017 Clause 3.1.2 states that the resistance of protective earthing conductors must be low enough to allow sufficient current to flow in the earth fault-loop to operate the circuit protective device within a specified disconnection time. This ensures that if there's a fault, the protective device will trip and prevent electric shock or fire hazards.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q38: What is the polarity test and why is it done?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
The polarity test ensures that the active, neutral, and earthing conductors are correctly connected to prevent shock hazards. It's done to confirm that active and neutral conductors are not transposed, which could energize the earthing system, and to ensure that switches operate correctly without leaving parts of appliances energized when turned off.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q39: How often must portable appliances be tested in a workshop?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
The extracts I have don't cover the specific frequency for testing portable appliances in a workshop. This is typically outlined in workplace health and safety regulations or specific industry standards rather than the Australian Standards provided. Check the full standard or relevant regulations for detailed requirements.
```

### Q40: What are the pass/fail criteria for in-service insulation resistance testing of a power tool?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
The extracts I have don't cover the specific pass/fail criteria for in-service insulation resistance testing of a power tool. Check the full standard or ask a more specific question about insulation resistance testing.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q42: What is the prospective short circuit current requirement at the main switchboard?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
The extracts I have don't cover that specific question. Check the full standard or ask a more specific question about prospective short circuit current requirements.
```

### Q43: What is the maximum disconnection time for a 230V TN-S system fault?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: Safety-critical query has no ⚠️ warning
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
The extracts I have don't cover the specific question about the maximum disconnection time for a 230V TN-S system fault. Check the full standard or ask a more specific question about disconnection times or fault conditions.
```

### Q44: What are the AS/NZS 3000 requirements for isolating a solar inverter?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
The extracts I have don't cover the specific requirements for isolating a solar inverter according to AS/NZS 3000. You may want to check the full standard or ask a more specific question about inverter isolation.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q45: What labelling is required on a solar installation at the switchboard?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q46: What classification system applies to hazardous areas for electrical equipment?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
The extracts I have don't cover the specific classification system for hazardous areas for electrical equipment. Check the full standard or ask a more specific question about hazardous area classifications.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q47: What circuit requirements apply to an electric hot water system?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.
```

### Q49: What does the wiring rules say about working on live electrical equipment?
**HTTP Status:** 200
**Confidence:** 0.80
**Issues:**
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
**Response:**
```
AS/NZS 3000 Clause 1.2 states that electrical testing inherently involves some degree of hazard, and it is the responsibility of the person performing the tests to ensure that safe practices are used. Testing with the supply connected may be conducted, but greater care must be exercised to avoid contact with live parts. Equipment should be treated as energized until proven otherwise.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

### Q50: What are the requirements for a safety observer when working on high voltage equipment?
**HTTP Status:** 200
**Confidence:** 0.60
**Issues:**
- FAIL: No clause citation in response (expected AS/NZS XXXX Clause Y.Y format)
- FAIL: API flagged needs_review (possible hallucinated citation or low grounding)
- FAIL: Confidence score 0.60 is below 0.70 threshold
**Response:**
```
This isn't covered in the sections I can see. Try rephrasing your question or check the full standard directly.

⚠️ This topic is safety-critical. Always verify on site against your specific installation and consult a licensed tradesperson or engineer for final compliance.
```

## Recommendations Before Going Live

- 🔴 **Citation rate is low (23 queries returned no clause).** Check that standards are uploaded and chunked correctly. The AI cannot cite what it hasn't retrieved.
- 🔴 **Safety warning failures: 5 safety-critical queries missing ⚠️.** Review SAFETY_CRITICAL_KEYWORDS list in validation.ts and add missing electrical keywords.
- 🔴 **Hallucination rate high (41 queries).** Reduce model temperature (currently 0.1 — already low), increase match_threshold, or add stricter citation grounding.
- 🔴 **High rate of low-confidence responses (10).** This suggests the vector search is not finding good matches. Check embeddings are generated for all chunks and similarity threshold (currently 0.30) is appropriate.
- 🔴 **Pass rate 18.0% — below acceptable threshold. Do not launch until failures are addressed.**
