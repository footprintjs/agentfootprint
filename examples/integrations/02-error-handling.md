---
name: LLMError taxonomy + classification
group: integrations
guide: ../../docs/guides/adapters.md#error-handling
defaultInput: ''
---

# LLMError taxonomy + classification

Every adapter normalizes failures to `LLMError` with a uniform error code (`auth`, `rate_limit`, `context_length`, `invalid_request`, `server`, `timeout`, `aborted`, `network`, `unknown`). One handler, every provider. The `retryable` flag tells you whether a retry is worth attempting.

## When to use

- Wiring `withRetry({ shouldRetry: (e) => e.retryable })` once for all providers.
- Surfacing user-friendly messages — auth errors require human action, rate-limits don't.
- Logging / alerting on specific error classes.

## What you'll see

Four status codes and three error variants classified consistently:

```
{
  classifications: { '401': 'auth', '429': 'rate_limit', '500': 'server', '413': 'context_length' },
  rateLimitError: { code: 'rate_limit', retryable: true },
  authError:      { code: 'auth',       retryable: false },
  wrappedNetworkError: { code: 'network', retryable: true },
}
```

## Key API

- `LLMError({ message, code, provider, statusCode? })` — construct.
- `classifyStatusCode(httpStatus)` — HTTP code → uniform code.
- `wrapSDKError(originalError, provider)` — convert vendor-SDK exceptions to `LLMError`.
- `error.retryable` — derived from code (rate_limit / server / timeout / network → true).

## Related

- [adapters guide](../../docs/guides/adapters.md#error-handling) — full code taxonomy.
- [resilience/01-runner-wrappers](../resilience/01-runner-wrappers.md) — `withRetry` consuming the `retryable` flag.
- [resilience/02-provider-fallback](../resilience/02-provider-fallback.md) — `shouldFallback` consuming `LLMError.code`.
