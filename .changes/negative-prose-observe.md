---
type: added
---

**Observe negative claims in ordinary agent answers.** `.negativeClaims({ prose: true })` compares data-anchored prose claims with native tool observations without requiring an output schema, citation field or answer validator. It preserves the answer and normal streaming, adds no correction call, and never withholds or verifies prose. Current-turn findings make the answer assessment not-sure; silence from the heuristic does not mean verified. App answer validation remains independent, and the prose-only arm refuses `.outputFallback()` because that path can replace an answer after observation.

**Subscribe to bounded prose warnings.** `agentfootprint.findings.negative_claim` emits once per claim or unread-unit finding, with locations, checker codes, phrase-pack identity and native result references, never answer text or tool values. App literal phrases can extend the observer within fixed limits. Code, recognized unsupported languages and exceeded size or shared work budgets produce explicit notes; exhaustion replaces partial findings with one input-limit note. The English heuristic can miss claims or flag correct ones, and its revised behavior remains unmeasured until the planned benchmark; `strictProse` and `enforceProse` stay unavailable.
