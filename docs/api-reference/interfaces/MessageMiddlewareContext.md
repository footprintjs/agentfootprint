[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MessageMiddlewareContext

# Interface: MessageMiddlewareContext

Defined in: [src/core/agent/middleware/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/agent/middleware/types.ts#L210)

The message a message middleware is deciding about.

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/core/agent/middleware/types.ts:220](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/agent/middleware/types.ts#L220)

The content as THIS middleware sees it — earlier transforms applied.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/middleware/types.ts:222](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/agent/middleware/types.ts#L222)

Conversation so far. Empty at `'input'`.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:223](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/agent/middleware/types.ts#L223)

***

### phase

> `readonly` **phase**: `"input"` \| `"output"`

Defined in: [src/core/agent/middleware/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/agent/middleware/types.ts#L218)

`'input'` runs at the very top of the run, BEFORE the user's message is
committed — so the window strategies, the injections, the slots, the
request bytes and every later slice all see the transformed text and
agree with each other. `'output'` runs where the final answer is
captured, so the record and the caller receive the same string.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:224](https://github.com/footprintjs/agentfootprint/blob/2af99f94a1c1703f8c3766c38cab67362ed57f5b/src/core/agent/middleware/types.ts#L224)
