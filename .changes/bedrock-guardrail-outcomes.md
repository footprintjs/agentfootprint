---
type: added
---

**Explicit Bedrock guardrails preserve masked output and distinguish blocked from unknown responses.** Both Converse transports accept a guardrail declaration, privately classify supported assessment actions and carry bounded safe intervention metadata. Masked output keeps the returned text and normal final-memory path; blocked and unresolved outcomes stop before tools, output repair or final-memory writes. Configured streams hold content through post-stop metadata and natural completion, refuse a private-buffer overflow without truncation, and do not resend an incomplete or terminal response. An optional synchronous clean-message hook changes presentation only. Raw trace and matched values stay out of returned intervention metadata and recordings; earlier effects are not rolled back.
