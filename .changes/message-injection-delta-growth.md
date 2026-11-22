---
type: breaking
---
**Growing conversation records store appended message injections as deltas.**
Live and saved `context.injected` events keep their recency labels.

Migration: Native `messagesInjections` rows in a snapshot now carry
`recencyFromOrder: true` in place of a stored label. Use the last row of the
composition for `latest` and all earlier rows for `earlier`, or read the label
from `context.injected` events. Custom events retain the label their writer supplied,
including an omitted label.
