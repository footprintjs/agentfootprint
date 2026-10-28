---
type: fixed
bump: minor
---
**`fileObservability` no longer tears NDJSON lines, and `agent.shutdown()` no longer hangs on a stuck sink.** The file sink's timer started its write directly, while size-triggered writes and `flush()` waited their turn. A large `appendFile` is several writes, so a timed append could overlap another one: lines were split and failed `JSON.parse`, events landed out of order, two batches could skip a rotation, and `flush()` could return before a timed write landed (reported in #223). `cloudwatchObservability`, `agentcoreObservability` and `xrayObservability` had the same timer, so two puts could be in flight at once and `flush()` could return early.

All three now share one queue: every trigger (size, timer, `flush()`, shutdown) waits its turn, one batch is in flight at a time, and batches leave in the order events arrived. File rotation runs inside that turn. `flush()` resolves only once nothing is buffered or in flight, and an event that arrives while it waits is written by it. A failed batch is still dropped and reported once, and later batches go on. An `onError` hook that throws is now reported on the console instead of becoming an unhandled rejection.

`agent.shutdown()` takes a new `timeoutMs` option (default 30 000, the same as `drainObservers`; `Infinity` waits without a deadline). A sink whose flush has not finished by then is reported by name through its own `onError`, and the shutdown continues. Before, a write that never settled, such as one on a hung network mount, held `shutdown()` forever.
