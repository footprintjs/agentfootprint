---
type: added
---

**Correct a proposed time without starting the question over.** The existing ISO range field keeps its ID, format, choices and labels, with an optional text sibling for a zone correction, new time words or a full interval. Fill exactly one; unsupported text, both fields or neither stay pending with a reason. Range validation remains strict, and corrected words still need the existing meaning confirmation.

Relative phrases retain their stated zone and original clock anchor. An elapsed interval never needs another zone question just to change its display: a readable zone is retained; an unmapped or unrepresentable label is quoted alongside UTC with an explicit “not converted” notice. Calendar readings still ask when the zone can change either interval boundary. The reply decision and its rule are recorded through the existing time/ask owners; the fix adds no mounted chart or pause topology. Host correction-box rendering follows after the library release.

An accepted correction retains only its canonical elapsed duration or absolute interval in the existing answer row. Later calls and the served window use that meaning instead of the superseded original words. The new optional data contains no correction text or parser output; old answer rows retain their existing interpretation.

Lowercase safe abbreviations and capitalized or time-qualified regional words remain explicit tokens, never inferred places. Ordinary singular lookbacks accept one, a or an. Replacement time words retain the pending question's stated zone unless the person supplies another. Sub-millisecond clocks retain their exact corrected duration.

The two additive ask-message keys are optional and have defaults. A paired correction ask has `missing: []` because neither field is individually required; the reply decoder still enforces exactly one filled channel. Existing hosts keep reading the range format, choices and labels. The existing unknown-clock-zone question remains for elapsed words too; removing that extra question is a separate follow-up.
