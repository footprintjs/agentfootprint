**Support** — one cache strategy per prompt-caching CAPABILITY, chosen from
what the provider declares (`LLMProvider.promptCaching`), never from its name.

## What it reads / what it writes
Reads the markers the cache decision produced and the provider's declaration;
returns the request with the markers the wire can take. No scope, no events,
no sentence. The adapter owns the wire format (`cache_control` lives in
`adapters/llm/anthropicCacheWire.ts`).

## The one law here
A strategy annotates; it never edits content. If a provider declares no
caching, the no-op strategy is the honest answer — and the meter says *not
applicable*, never zero.

## Files
- `BreakpointCacheStrategy.ts` — `mode: 'breakpoints'`: clamp to the declared
  `maxBreakpoints`, put the markers on the request.
- `AutomaticCacheStrategy.ts` — `mode: 'automatic'`: pass-through; the
  provider caches on its own.
- `NoOpCacheStrategy.ts` — nothing declared.

Selection is `../cacheStrategyFor.ts`.

```ts
cacheStrategyFor(withRetry(anthropic())).name; // 'breakpoints' — the decorator forwards the declaration
```
