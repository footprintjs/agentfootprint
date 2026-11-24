---
title: LLMChunk
---

# Interface: LLMChunk

Defined in: [src/provider-contract/types.ts:456](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L456)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/provider-contract/types.ts:459](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L459)

Token text. Empty for the terminal chunk (`done: true`).

***

### done

> `readonly` **done**: `boolean`

Defined in: [src/provider-contract/types.ts:461](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L461)

True only for the final chunk in a stream.

***

### response?

> `readonly` `optional` **response?**: [`LLMResponse`](/docs/api/interfaces/LLMResponse)

Defined in: [src/provider-contract/types.ts:474](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L474)

Authoritative response payload, populated ONLY on the final chunk
(`done: true`). Carries `toolCalls`, `usage`, `stopReason` — the
fields that drive the ReAct loop. The `content` mirrors the
concatenation of all non-terminal chunks; consumers can use
either source.

Streaming providers SHOULD populate this. Older providers that
yield only text and end with `done: true` (no `response`) are
still supported — Agent falls back to `complete()` for the
authoritative payload in that case.

***

### thinkingDelta?

> `readonly` `optional` **thinkingDelta?**: `string`

Defined in: [src/provider-contract/types.ts:480](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L480)

Live thinking text. Nonempty fragments on nonterminal chunks drive
`agentfootprint.stream.thinking_delta` events under the run's redaction policy.
Adapters keep signatures, redacted blocks and private data out of this field.

***

### thinkingKind?

> `readonly` `optional` **thinkingKind?**: [`ThinkingDeltaKind`](/docs/api/type-aliases/ThinkingDeltaKind)

Defined in: [src/provider-contract/types.ts:482](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L482)

Classification from the provider request. Omit it when neither classification can be confirmed.

***

### tokenIndex

> `readonly` **tokenIndex**: `number`

Defined in: [src/provider-contract/types.ts:457](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types.ts#L457)
