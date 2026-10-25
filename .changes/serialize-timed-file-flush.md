---
type: fixed
---
**File event logs keep timer-triggered writes in order.** Timed flushes now join
the same queue as size-triggered and explicit flushes. A slow append can no
longer overlap the next timed append, and `flush()` waits for a timed write that
has already started. This prevents overlapping appends from reordering events
or splitting NDJSON lines within one sink instance.
