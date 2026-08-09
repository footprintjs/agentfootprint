[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMChunk

# Interface: LLMChunk

Defined in: [src/adapters/types.ts:262](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/adapters/types.ts#L262)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/adapters/types.ts:265](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/adapters/types.ts#L265)

Token text. Empty for the terminal chunk (`done: true`).

***

### done

> `readonly` **done**: `boolean`

Defined in: [src/adapters/types.ts:267](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/adapters/types.ts#L267)

True only for the final chunk in a stream.

***

### response?

> `readonly` `optional` **response?**: [`LLMResponse`](/agentfootprint/api/generated/interfaces/LLMResponse.md)

Defined in: [src/adapters/types.ts:280](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/adapters/types.ts#L280)

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

Defined in: [src/adapters/types.ts:297](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/adapters/types.ts#L297)

v2.14 — streaming thinking-content tokens. Parallel to `content`
but for the model's reasoning chain rather than visible output.
Set on chunks that carry thinking deltas (Anthropic emits these
via `content_block_delta` events with `delta.type === 'thinking_delta'`);
undefined or empty on chunks that carry only visible-content tokens.

Frameworks: this field drives `agentfootprint.stream.thinking_delta`
events when a `ThinkingHandler.parseChunk()` returns one. Consumers
who want to render thinking-as-it-streams subscribe to that event.

Default consumer behavior: thinking tokens are not surfaced to end
users unless a consumer explicitly subscribes to the
`agentfootprint.stream.thinking_delta` event (or renders it through a
live-status strategy).

***

### tokenIndex

> `readonly` **tokenIndex**: `number`

Defined in: [src/adapters/types.ts:263](https://github.com/footprintjs/agentfootprint/blob/f7aefd072fb1f22dbb28729feade35990af9f796/src/adapters/types.ts#L263)
