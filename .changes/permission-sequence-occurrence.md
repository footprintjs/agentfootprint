---
type: fixed
bump: patch
---
**Corrected result attribution in permission-checker call sequences.** A proposal’s
recorded result stays with that call when a provider reuses a tool-call ID. This helps
custom checkers that read the sequence. The built-in role allowlist uses role,
capability, and target instead of call history.
