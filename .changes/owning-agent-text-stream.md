---
type: fixed
---
**Finish SSE streams at the owning Agent's turn end.** Both `toSSE()` formats
now continue past a mounted Agent's turn end and deliver the owning Agent's
response through its marked turn end. This applies to fresh streams, streams
retained across a pause, and streams opened to resume a turn.

A full-format stream opened to resume a turn now closes at the next pause, as
a text stream does. It used to stay open until the turn ended.
