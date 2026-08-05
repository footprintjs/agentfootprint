---
title: MessageMiddlewareContext
---

# Interface: MessageMiddlewareContext

Defined in: [src/core/agent/middleware/types.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L137)

The message a message middleware is deciding about.

## Properties

### content

> `readonly` **content**: `string`

Defined in: [src/core/agent/middleware/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L147)

The content as THIS middleware sees it — earlier transforms applied.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/agent/middleware/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L149)

Conversation so far. Empty at `'input'`.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L150)

***

### phase

> `readonly` **phase**: `"input"` \| `"output"`

Defined in: [src/core/agent/middleware/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L145)

`'input'` runs at the very top of the run, BEFORE the user's message is
committed — so the window strategies, the injections, the slots, the
request bytes and every later slice all see the transformed text and
agree with each other. `'output'` runs where the final answer is
captured, so the record and the caller receive the same string.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:151](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L151)
