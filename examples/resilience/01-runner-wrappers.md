---
name: withRetry / withFallback / withCircuitBreaker
group: resilience
guide: ../../docs/guides/orchestration.md
defaultInput: Do something unreliable.
---

# withRetry / withFallback / withCircuitBreaker

Wrap any `RunnerLike` with retry, fallback, or circuit-breaker semantics. Production-grade resilience without modifying the underlying runner.

## When to use

- **`withRetry`** — transient failures (rate limits, network blips). Configurable backoff + selective retry predicate.
- **`withFallback`** — primary fails → run a backup. Cost-down or quality-down secondary.
- **`withCircuitBreaker`** — stop hammering a downed service. Fast-fail after N consecutive failures, probe after a cooldown.

All three return `RunnerLike`, so they compose naturally: `withCircuitBreaker(withRetry(withFallback(primary, backup)))`.

## What you'll see

The example wraps a flaky runner that fails twice then succeeds:

```
{ content: 'Success on attempt 3', attempts: 3 }
```

`withRetry({ maxRetries: 5, backoffMs: 0 })` swallowed the first two failures and returned the third try's success.

## Key API

- `withRetry(runner, { maxRetries, backoffMs?, backoffMultiplier?, shouldRetry? })`.
- `withFallback(primary, backup, { shouldFallback? })`.
- `withCircuitBreaker(runner, { threshold?, resetAfterMs? })` — exposes `.breaker.getState()` for inspection.

## Stacking order matters

Outer wrapper sees errors only AFTER inner wrappers have had their chance. Common mistake: `withCircuitBreaker(withRetry(...))` — every retry counts as a separate breaker probe, so the breaker never trips. Reverse the order if you want one logical "request" per breaker tick. See [orchestration guide](../../docs/guides/orchestration.md) for the full discussion.

## Related

- [orchestration guide](../../docs/guides/orchestration.md).
- [02-provider-fallback](./02-provider-fallback.md) — same idea at the LLMProvider level instead of the Runner level.
