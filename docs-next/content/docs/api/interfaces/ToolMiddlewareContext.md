---
title: ToolMiddlewareContext
---

# Interface: ToolMiddlewareContext

Defined in: [src/core/agent/middleware/types.ts:176](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L176)

The call a tool middleware is deciding about.

## Extended by

- [`ToolResultContext`](/docs/api/interfaces/ToolResultContext)

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/agent/middleware/types.ts:199](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L199)

The args as THIS middleware sees them — every earlier transform in the
chain already applied. The first middleware sees what the model asked
for; the last sees what the tool is about to receive.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/agent/middleware/types.ts:201](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L201)

Conversation so far, including the assistant turn that made this call.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:203](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L203)

Multi-tenant run identity, when the run carried one.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:193](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L193)

ReAct iteration this call belongs to.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L205)

Abort signal from `run({ env: { signal } })`.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/middleware/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L191)

Matches `stream.tool_start.toolCallId` for this dispatch.

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/middleware/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L177)

***

### toolSource?

> `readonly` `optional` **toolSource?**: `string`

Defined in: [src/core/agent/middleware/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L189)

Where the tool being called came from — `Tool.source`, which `mcpClient`
fills with the server's name.

**Absent means the agent's own tool.** A name alone is not an identity: two
MCP servers may both serve a `call_aws`, and a policy matching the bare
name governs whichever one answers — including the one it was never written
about. With this, `call.toolSource === 'aws-prod'` is a rule that means what
it says, and `call.toolSource === undefined` is the honest way to spell
"something we wrote ourselves".
