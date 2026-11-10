---
type: fixed
---
**File telemetry keeps complete JSON lines when timed and size-triggered writes overlap.** Timed batches now join the same append queue as manual and size-triggered flushes. This preserves dispatch order on slow disks and makes `flush()` wait for a timed write already in flight.
