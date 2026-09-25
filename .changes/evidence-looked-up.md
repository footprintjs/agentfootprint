---
type: added
---
**`evidence_checked.lookedUp` says how many of the answer's values were actually looked up.** `candidates` also counts values the person's message, the conversation or the app's own instructions already held — those are exempt and never looked up — so "looked up `candidates` values" overclaimed. `lookedUp` (also on `EvidenceVerdict`) is the values found plus the values not found, before the reported list is cut at 12. Every `evidence_checked` carries it from this release; the event exists only when `.namesAndNumbersFromEvidence()` is armed, so an agent without it gains no byte.
