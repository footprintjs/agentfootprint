---
type: security
---

**Model-facing traces respect tool-result middleware.** Earlier versions that support both result middleware and model-facing traces are affected when `.selfExplain()` or a model-facing trace pack is used with an `onToolResult` rule that denies or rewrites a result. Upgrade to this release. Host-owned recordings remain available under their existing redaction policy.
