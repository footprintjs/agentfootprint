---
name: fallbackProvider — multi-provider failover
group: resilience
guide: ../../docs/guides/security.md#provider-fallback--fallbackprovider
defaultInput: Hello!
---

# fallbackProvider — multi-provider failover

Wrap multiple `LLMProvider` instances into one. Tries them in order; on failure, falls through to the next. Operates at the provider interface, so it can switch between **model families** (Claude → GPT → local Ollama) — something infrastructure load balancers can't do.

## When to use

- Multi-vendor strategy — Anthropic primary, OpenAI backup, local Ollama as final-resort.
- Rate-limit recovery — fall over to a different provider when the primary 429s.
- Cost optimization — try a cheap model first, escalate only on errors.

## What you'll see

The primary throws "429 Rate Limited"; the backup succeeds:

```
{
  content: 'Hello! I am the backup provider. The primary was rate limited.',
  fallbacks: ['Falling back from 0 to 1: 429 Rate Limited'],
}
```

## Key API

- `fallbackProvider(providers, { shouldFallback?, onFallback? })`.
- `shouldFallback(error)` — predicate that decides whether to fall through (default: always).
- `onFallback(from, to, error)` — observability hook, fires per transition.

## resilientProvider

For production: `resilientProvider(...)` wraps `fallbackProvider` with per-provider circuit breakers. When a provider is known down (breaker tripped), it's skipped instantly — no wasted timeout wait. See [security guide](../../docs/guides/security.md#resilient-provider--resilientprovider).

## Related

- [security guide](../../docs/guides/security.md) — `fallbackProvider` and `resilientProvider` together.
- [01-runner-wrappers](./01-runner-wrappers.md) — same pattern at the Runner level instead of the Provider level.
