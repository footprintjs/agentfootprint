---
type: fixed
---
**`fileObservability` no longer tears NDJSON lines.** The file sink's timer started its write directly, while size-triggered writes and `flush()` waited their turn. A large `appendFile` is several writes, so a timed append could overlap another one: lines were split and failed `JSON.parse`, events landed out of order, two batches could skip a rotation, and `flush()` could return before a timed write landed (reported in #223). `cloudwatchObservability`, `agentcoreObservability` and `xrayObservability` had the same timer, so two puts could be in flight at once and `flush()` could return early.

All three now share one queue: every trigger (size, timer, `flush()`) waits its turn, one batch is in flight at a time, and batches leave in the order events arrived. File rotation runs inside that turn. `flush()` resolves once every event accepted before it was called is delivered, a timed write already in flight included, after one more sweep of what arrived while it waited. It does not chase a producer that keeps emitting. A failed batch is still dropped and reported once, and later batches go on. An `onError` hook that throws is now reported on the console instead of becoming an unhandled rejection.

`maxBufferEvents` (file), `maxBatchEvents` (CloudWatch, AgentCore) and `maxBatchSegments` (X-Ray) must now be positive whole numbers; anything else is refused at construction, naming the option. `0` used to mean "deliver every event at once" for the file and CloudWatch sinks — pass `1` for that. On X-Ray, `0` made empty puts in a loop.
