**Support** — one cache strategy per provider: where that vendor allows a cache
breakpoint and what it calls one.

## What it reads / what it writes
Reads the markers the cache decision produced; returns the vendor-shaped
annotation. No scope, no events, no sentence.

## The one law here
A strategy annotates; it never edits content. If a provider cannot cache, the
no-op strategy is the honest answer.

## Files
- `AnthropicCacheStrategy.ts`, `OpenAICacheStrategy.ts`,
  `BedrockCacheStrategy.ts` — one vendor each.
- `NoOpCacheStrategy.ts` — the wildcard fallback.
