**Support** — four composable decorators over `LLMProvider` (retry, fallback,
fallback chain, circuit breaker), each preserving the port so they stack freely.

## What it reads / what it writes
- Reads the request as composed, and the provider's failure.
- Writes nothing on scope and changes nothing in the request. A fallback swaps
  WHO answers, never WHAT was asked.

## The one law here
The port survives every wrapper. A decorator that changed the request would be
composing, and composing belongs to a Lens.

## Files
- `withRetry.ts`, `withFallback.ts`, `withCircuitBreaker.ts`,
  `fallbackProvider.ts`, `index.ts`.
