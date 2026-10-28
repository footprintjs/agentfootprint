---
type: changed
---
**AgentCore Runtime's session-busy retry now waits long enough for a session to start.** Its default backoff is 500 ms doubling with equal jitter (it was 200 ms): 3.75–7.5 s of waiting across its 5 attempts, so a runtime session that takes up to about 3.4 s to come up is waited out on every draw, still inside the 10 s waiting ceiling. Plain `mcpClient` 429 defaults are unchanged.

Also changed, under `mcpClient` with that transport: a 429 is retried inside the transport's series — in the same runtime session, within the transport's `retry.maxAttempts` (raise that to allow more), with `retryOnThrottle.maxAttempts` still limiting the 429 retries. For every MCP retry: a request whose signal is already aborted is not sent at all (it rejects with the abort's reason), a throwing `onRetry` no longer fails the call, `onRetry`'s `waitMs` is the exact wait (it can carry a fraction of a millisecond; it was rounded), and its `url` keeps only the endpoint's origin and path (it was the whole URL, user info, query and fragment included).
