---
type: changed
bump: minor
---
**`agent.shutdown()` now stops waiting for a sink's flush after 30 seconds by default.** Before, `shutdown()` waited for every enabled sink to finish flushing, however long that took. A sink whose write never settled (a hung network mount under the file sink, or a network call with no timeout) held `shutdown()` forever.

Now each sink's flush gets one deadline, `timeoutMs`. A sink still flushing at the deadline is reported by name through its own `onError` (on the console when it has none): its delivery is still in flight, either still delivering or stuck. The shutdown then goes on and stops the handles. The write itself is not cancelled; nothing can cancel it. **What this changes for you:** a slow but healthy sink whose flush takes longer than 30 s now has its tail reported instead of waited for.

- **Keep the old behaviour** (wait as long as it takes): `await agent.shutdown({ timeoutMs: Infinity })`.
- **Pick your own bound**, e.g. inside a Lambda's remaining time: `await agent.shutdown({ timeoutMs: 5_000 })`.

A `timeoutMs` that is not a positive number makes the returned promise reject with a `TypeError`; nothing is thrown synchronously. When a shutdown is already in flight, a second call joins it: its own `timeoutMs` is still checked, but the first call's deadline governs, as its `stop` already did.
