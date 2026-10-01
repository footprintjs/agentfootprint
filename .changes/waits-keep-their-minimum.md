---
type: fixed
---
**A wait the library promises now lasts at least as long as it says.** Seven
waits each slept on a bare `setTimeout`: the retry back-offs (`withRetry`,
`withCredentialRetry`, the MCP 429 retry, the `typesafe` classifier), the GitHub
device-flow poll, `MockProvider`'s `thinkingMs` and `chunkDelayMs`, and the
sign-in door's limiter delay and minimum-time wait. Node fires a timer when its
event-loop clock — whole milliseconds, floored when the timer is armed — says
the time is up, so a timer can fire up to a millisecond early, more on Linux,
and a fractional delay is truncated. A retry could go out before the server's
`Retry-After` had passed, and a 5 ms back-off could measure 4. All seven now go
through one wait that reads `performance.now()` and keeps waiting until the full
time has passed. A wait of 0 now resolves at once rather than after a timer tick
(`typesafe` with `retryDelayMs: 0`, a device-flow `interval` of 0), and a wait
longer than 2^31 − 1 ms is honoured instead of becoming 1 ms.

If your tests drive these waits with fake timers, the fake must cover
`performance` as well as `setTimeout`. Vitest 4's `vi.useFakeTimers()` fakes
both by default; a `toFake` list that names `setTimeout` but not `performance`
leaves the wait waiting for real time.
