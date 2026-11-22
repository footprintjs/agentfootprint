---
type: added
---
**Show provider summaries while answer drafts are held.** Set `liveThinkingWithHeldDrafts: 'provider-summary'` on `Agent.create` to receive classified provider summaries before the answer is approved. The summaries use the existing stream event, run redaction, and first-chunk retry rule. Draft answer text and other live thinking stay held under the output policy.
