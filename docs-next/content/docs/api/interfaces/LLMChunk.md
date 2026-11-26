---
title: LLMChunk
---

# Interface: LLMChunk

Defined in: [src/provider-contract/types/response.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/response.ts#L118)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/provider-contract/types/response.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/response.ts#L121)

Token text. Empty for the terminal chunk (`done: true`).

***

### done

> `readonly` **done**: `boolean`

Defined in: [src/provider-contract/types/response.ts:123](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/response.ts#L123)

True only for the final chunk in a stream.

***

### response?

> `readonly` `optional` **response?**: [`LLMResponse`](/docs/api/interfaces/LLMResponse)

Defined in: [src/provider-contract/types/response.ts:136](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/response.ts#L136)

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

Defined in: [src/provider-contract/types/response.ts:142](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/response.ts#L142)

Live thinking text. Nonempty fragments on nonterminal chunks drive
`agentfootprint.stream.thinking_delta` events under the run's redaction policy.
Adapters keep signatures, redacted blocks and private data out of this field.

***

### thinkingKind?

> `readonly` `optional` **thinkingKind?**: [`ThinkingDeltaKind`](/docs/api/type-aliases/ThinkingDeltaKind)

Defined in: [src/provider-contract/types/response.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/response.ts#L144)

Classification from the provider request. Omit it when neither classification can be confirmed.

***

### tokenIndex

> `readonly` **tokenIndex**: `number`

Defined in: [src/provider-contract/types/response.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/provider-contract/types/response.ts#L119)
