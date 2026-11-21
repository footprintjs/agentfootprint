---
type: breaking
---
**Growing conversation records store appended message injections as deltas.**
Live and saved `context.injected` events keep their recency labels.

Migration: If you read native `messagesInjections` rows directly from a
snapshot, use the last row of the composition for `latest` and all earlier
rows for `earlier`, or read the label from `context.injected` events.
