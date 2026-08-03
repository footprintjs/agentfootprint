[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MessageMiddlewareContext

# Interface: MessageMiddlewareContext

Defined in: src/core/agent/middleware/types.ts:125

The message a message middleware is deciding about.

## Properties

### content

> `readonly` **content**: `string`

Defined in: src/core/agent/middleware/types.ts:135

The content as THIS middleware sees it — earlier transforms applied.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: src/core/agent/middleware/types.ts:137

Conversation so far. Empty at `'input'`.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: src/core/agent/middleware/types.ts:138

***

### phase

> `readonly` **phase**: `"input"` \| `"output"`

Defined in: src/core/agent/middleware/types.ts:133

`'input'` runs at the very top of the run, BEFORE the user's message is
committed — so the window strategies, the injections, the slots, the
request bytes and every later slice all see the transformed text and
agree with each other. `'output'` runs where the final answer is
captured, so the record and the caller receive the same string.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: src/core/agent/middleware/types.ts:139
