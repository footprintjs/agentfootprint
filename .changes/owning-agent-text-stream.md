---
type: fixed
---
**Finish SSE streams at the owning Agent's turn end.** Both `toSSE()` formats
now continue past a mounted Agent's turn end and deliver the owning Agent's
response through its marked turn end. This applies to fresh streams, streams
retained across a pause, and streams opened to resume a turn.
