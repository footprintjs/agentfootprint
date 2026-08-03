---
title: ToolMiddlewareContext
---

# Interface: ToolMiddlewareContext

Defined in: [src/core/agent/middleware/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L104)

The call a tool middleware is deciding about.

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/agent/middleware/types.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L115)

The args as THIS middleware sees them — every earlier transform in the
chain already applied. The first middleware sees what the model asked
for; the last sees what the tool is about to receive.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/agent/middleware/types.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L117)

Conversation so far, including the assistant turn that made this call.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L119)

Multi-tenant run identity, when the run carried one.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L109)

ReAct iteration this call belongs to.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L121)

Abort signal from `run({ env: { signal } })`.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/middleware/types.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L107)

Matches `stream.tool_start.toolCallId` for this dispatch.

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/middleware/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L105)
