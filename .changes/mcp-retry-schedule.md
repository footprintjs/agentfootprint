---
type: added
bump: minor
---
**Tune how MCP calls wait before retrying — and one retry budget per call.** `retryOnThrottle` and `agentCoreRuntimeMcpTransport({ retry })` now take `baseDelayMs`, `multiplier`, `jitter` (`'none' | 'equal' | 'full'`), `maxDelayMs` (the most one of the library's own backoff waits may last — never a server's `Retry-After`) and `maxElapsedMs` (a deadline for the whole call, requests included), beside `maxAttempts`, `maxWaitMs` and `onRetry`. `onRetry` also says which refusal it answers: `kind` is `'throttle'` or `'session-busy'`; it is never told the call's arguments or the server's answer.

Each MCP call is now one retry series on footprintjs's `attempt()` runner. Under `mcpClient`, an AgentCore Runtime transport's session-busy retry and the client's 429 retry share that series instead of nesting, so they share one attempt count, one waiting total and one deadline: a call makes at most the transport's `retry.maxAttempts` requests whatever refusals it meets. A `Retry-After` is honoured whole: `maxDelayMs` caps only the library's own backoff, and a stated wait that would break `maxWaitMs` or the deadline is not begun — the 429 is delivered instead, never asked again early.
