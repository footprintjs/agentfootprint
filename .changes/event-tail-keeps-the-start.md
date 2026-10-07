---
type: fixed
---
**A long run's recording keeps its first iterations.** Every model call re-announces each piece of
its context (`agentfootprint.context.injected`), so a run fires events with the square of its
iteration count, and the event tail's 10,000-event cap evicted the START of long runs: a
100-iteration agent run fired ~11,500 events and its recording opened at iteration 34. The cap now
counts distinct events. An announcement equal, field for field, to one the tail still holds is kept
in its place — the stream stays whole and in order — but holds no slot, and shares the held
payload object. Identity is decided on the whole payload, never on the 32-bit `contentHash`, so two
different pieces are never merged. The same run now keeps all of its events (`droppedEvents: 0`).
`eventCount` still counts every captured event, repeats included; eviction is still oldest-first, so
the retained events are one contiguous suffix of the stream. The tail stays bounded in memory: slots
and repeats together are capped at ten times `maxEvents` (100,000 events at the default), past which
the oldest go and are counted as dropped.
