**Support** — four composable decorators over `LLMProvider` (retry, fallback,
fallback chain, circuit breaker), each preserving the port so they stack freely.

## What it reads / what it writes
- Reads the request as composed, and the provider's failure.
- Writes nothing on scope and changes nothing in the request. A fallback swaps
  WHO answers, never WHAT was asked.

## The one law here
The port survives every wrapper. A decorator that changed the request would be
composing, and composing belongs to a Lens.

## The stream law: retry before the first chunk, never after
`withRetry` re-opens a `stream()` that fails before its first chunk (a 429 or
5xx at connect) under the SAME policy as `complete()` — `maxAttempts`,
`shouldRetry`, backoff, `req.signal` — and reports it the same way
(`retried`, then `recovered` when the first chunk arrives). After the first
chunk nothing retries: `withRetry.ts · openStream` owns the only retry loop and
returns WITH the first chunk; the rest is `yield*` delegation with no catch.
`withFallback` pins a stream at the same boundary.

```ts
const robust = withRetry(anthropic({ apiKey }), { maxAttempts: 3 });
for await (const chunk of robust.stream!(req, hooks)) {
  // 429 at connect → retried, then these chunks arrive once each.
  // A reset after the first chunk → thrown here, never replayed.
}
```

## Files
- `withRetry.ts`, `withFallback.ts`, `withCircuitBreaker.ts`,
  `fallbackProvider.ts`, `index.ts`.
