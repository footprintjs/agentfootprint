---
title: OutputFallbackOptions<T>
---

# Interface: OutputFallbackOptions\<T\>

Defined in: [src/core/outputFallback.ts:89](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/outputFallback.ts#L89)

## Type Parameters

### T

`T`

## Properties

### canned?

> `readonly` `optional` **canned?**: `T`

Defined in: [src/core/outputFallback.ts:101](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/outputFallback.ts#L101)

Tier 3 — guaranteed-valid safety net. Validated against the
 schema at builder time (throws on mismatch — fail-fast on
 misconfig). When set, the agent NEVER throws on output-schema
 failure.

 When omitted, `fallback`-thrown errors propagate to the caller
 (consumer chooses fail-open vs fail-closed).

***

### fallback

> `readonly` **fallback**: [`OutputFallbackFn`](/docs/api/type-aliases/OutputFallbackFn)\<`T`\>

Defined in: [src/core/outputFallback.ts:93](https://github.com/footprintjs/agentfootprint/blob/cb725c3951ce2b7c0bf075ce35f889af1e57aaba/src/core/outputFallback.ts#L93)

Tier 2 — async function that produces a candidate value. May
 throw or return invalid data; the agent will fall through to
 `canned` if so.
