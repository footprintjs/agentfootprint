---
title: OutputFallbackOptions<T>
---

# Interface: OutputFallbackOptions\<T\>

Defined in: [src/core/outputFallback.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/core/outputFallback.ts#L111)

## Type Parameters

### T

`T`

## Properties

### canned?

> `readonly` `optional` **canned?**: `T`

Defined in: [src/core/outputFallback.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/core/outputFallback.ts#L123)

Tier 3 — guaranteed-valid safety net. Validated against the
 schema at builder time (throws on mismatch — fail-fast on
 misconfig). When set, the agent NEVER throws on output-schema
 failure.

 When omitted, `fallback`-thrown errors propagate to the caller
 (consumer chooses fail-open vs fail-closed).

***

### fallback

> `readonly` **fallback**: [`OutputFallbackFn`](/docs/api/type-aliases/OutputFallbackFn)\<`T`\>

Defined in: [src/core/outputFallback.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/outputFallback.ts#L115)

Tier 2 — async function that produces a candidate value. May
 throw or return invalid data; the agent will fall through to
 `canned` if so.
