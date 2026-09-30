---
type: added
---
**`invokeModelGateway({ timeoutMs })`: a deadline for each request.** Before this, a gateway that never answered held the run until the caller's own signal fired, if one was set. `timeoutMs` bounds the response headers, a `complete()` body, and each stream read: the first chunk, then every gap between chunks. A stream that keeps sending is never cut off. A missed deadline aborts the request and raises `InvokeModelGatewayError` with `reason: 'timeout'` and `retryable: true`, so `withRetry` asks again as long as no chunk has reached the caller. The caller's `req.signal` still wins. With no `timeoutMs` there is no deadline and the request is sent exactly as before.
