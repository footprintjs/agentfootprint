[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MessageMiddlewareContext

# Interface: MessageMiddlewareContext

Defined in: [src/core/agent/middleware/types.ts:218](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/middleware/types.ts#L218)

The message a message middleware is deciding about.

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/core/agent/middleware/types.ts:228](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/middleware/types.ts#L228)

The content as THIS middleware sees it — earlier transforms applied.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/middleware/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/middleware/types.ts#L230)

Conversation so far. Empty at `'input'`.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:231](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/middleware/types.ts#L231)

***

### phase

> `readonly` **phase**: `"input"` \| `"output"`

Defined in: [src/core/agent/middleware/types.ts:226](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/middleware/types.ts#L226)

`'input'` runs at the very top of the run, BEFORE the user's message is
committed — so the window strategies, the injections, the slots, the
request bytes and every later slice all see the transformed text and
agree with each other. `'output'` runs where the final answer is
captured, so the record and the caller receive the same string.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:232](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/middleware/types.ts#L232)
