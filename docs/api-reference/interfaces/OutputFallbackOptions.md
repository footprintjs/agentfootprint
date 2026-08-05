[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / OutputFallbackOptions

# Interface: OutputFallbackOptions\<T\>

Defined in: [src/core/outputFallback.ts:89](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/outputFallback.ts#L89)

## Type Parameters

### T

`T`

## Properties

### canned?

> `readonly` `optional` **canned?**: `T`

Defined in: [src/core/outputFallback.ts:101](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/outputFallback.ts#L101)

Tier 3 — guaranteed-valid safety net. Validated against the
 schema at builder time (throws on mismatch — fail-fast on
 misconfig). When set, the agent NEVER throws on output-schema
 failure.

 When omitted, `fallback`-thrown errors propagate to the caller
 (consumer chooses fail-open vs fail-closed).

***

### fallback

> `readonly` **fallback**: [`OutputFallbackFn`](/agentfootprint/api/generated/type-aliases/OutputFallbackFn.md)\<`T`\>

Defined in: [src/core/outputFallback.ts:93](https://github.com/footprintjs/agentfootprint/blob/b0d6df03c3c530d8a98631823e1b6745e8adc197/src/core/outputFallback.ts#L93)

Tier 2 — async function that produces a candidate value. May
 throw or return invalid data; the agent will fall through to
 `canned` if so.
