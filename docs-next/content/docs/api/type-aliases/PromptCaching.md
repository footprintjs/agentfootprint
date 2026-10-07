---
title: PromptCaching
---

# Type Alias: PromptCaching

> **PromptCaching** = \{ `maxBreakpoints`: `number`; `mode`: `"breakpoints"`; `reportsUsage`: `boolean`; \} \| \{ `mode`: `"automatic"`; `reportsUsage`: `boolean`; \}

Defined in: [src/adapters/types.ts:604](https://github.com/footprintjs/agentfootprint/blob/main/src/adapters/types.ts#L604)

How an adapter's wire caches a repeated prompt prefix — DECLARED by the
adapter, read by the agent to choose its cache strategy
(`agentfootprint/cache` · `cacheStrategyFor`).

- `'breakpoints'` — the provider caches a prefix only where the request
  marks it (Anthropic's `cache_control`). The adapter reads
  [LLMRequest.cacheMarkers](/docs/api/interfaces/LLMRequest#cachemarkers) and writes them on its wire, at most
  `maxBreakpoints` per request.
- `'automatic'` — the provider caches repeated prefixes on its own (OpenAI).
  Markers are inert; nothing the request says changes what is cached.

`reportsUsage` says whether the adapter lifts the provider's cache token
counts onto `LLMResponse.usage.cacheRead` / `cacheWrite`. The cache meter
reads it: `false` makes every call's cache claim *not applicable*, never a
zero.

## Union Members

### Type Literal

\{ `maxBreakpoints`: `number`; `mode`: `"breakpoints"`; `reportsUsage`: `boolean`; \}

#### maxBreakpoints

> `readonly` **maxBreakpoints**: `number`

Breakpoints the wire honours on one request (Anthropic: 4).

#### mode

> `readonly` **mode**: `"breakpoints"`

#### reportsUsage

> `readonly` **reportsUsage**: `boolean`

***

### Type Literal

\{ `mode`: `"automatic"`; `reportsUsage`: `boolean`; \}

## Example

```ts
// A wrapper forwards what it wraps, like every other capability:
const wrapped: LLMProvider = {
  name: `my-app/${inner.name}`,
  ...(inner.promptCaching !== undefined && { promptCaching: inner.promptCaching }),
  complete: (req, hooks) => inner.complete(req, hooks),
};
```
