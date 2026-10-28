---
type: changed
---
**AgentCore Runtime's session-busy retry now waits long enough for a session to start.** Its default backoff is 500 ms doubling with equal jitter (it was 200 ms): 3.75–7.5 s of waiting across its 5 attempts, so a runtime session that takes up to about 3.4 s to come up is waited out on every draw, still inside the 10 s waiting ceiling. Plain `mcpClient` 429 defaults are unchanged.

Also changed, under `mcpClient` with that transport: a 429 is retried inside the transport's series — in the same runtime session, within the transport's `retry.maxAttempts` (raise that to allow more), with `retryOnThrottle.maxAttempts` still limiting the 429 retries. For every MCP retry: a request whose signal is already aborted is not sent at all (it rejects with the abort's reason), and a throwing `onRetry` no longer fails the call.

Needs footprintjs 10.1.0: MCP retries run on its `attempt()` runner, first released there, so the `footprintjs` peer range is now `^10.1.0` (was `^9.47.0 || ^10.0.0`). Earlier agentfootprint releases keep working on footprintjs 9.x and 10.0.
