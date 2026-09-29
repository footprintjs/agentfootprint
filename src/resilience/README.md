**Support** — four composable decorators over `LLMProvider` (retry, fallback,
fallback chain, circuit breaker), each preserving the port so they stack freely.

## What it reads / what it writes
- Reads the request as composed, and the provider's failure.
- Writes nothing on scope and changes nothing in the request. A fallback swaps
  WHO answers, never WHAT was asked.

## The one law here
The port survives every wrapper. A decorator that changed the request would be
composing, and composing belongs to a Lens.

## Retry reads what the error declares
`withRetry`'s default predicate (`withRetry.ts` · `defaultShouldRetry`, shared
with `withCredentialRetry`) skips an `AbortError`, a 4xx other than 429, and an
error that declares `retryable: false`; it retries everything else, including an
error with no status. An adapter whose failure has no HTTP status and cannot be
mended by asking again — nothing was sent, or a 2xx already came back — sets
`retryable: false`, or the default policy repeats it. Only the literal `false` is
read, so an error without the field is judged exactly as before.

```ts
class NoKeyError extends Error {
  readonly retryable = false; // nothing was sent; a retry cannot find a key
}
withRetry(provider); // a NoKeyError is thrown once, with no backoff wait
```

## Files
- `withRetry.ts`, `withFallback.ts`, `withCircuitBreaker.ts`,
  `fallbackProvider.ts`, `index.ts`.
