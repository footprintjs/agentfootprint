---
title: ToolMiddlewareContext
---

# Interface: ToolMiddlewareContext

Defined in: [src/core/agent/middleware/types.ts:184](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L184)

The call a tool middleware is deciding about.

## Extended by

- [`ToolResultContext`](/docs/api/interfaces/ToolResultContext)

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/agent/middleware/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L207)

The args as THIS middleware sees them — every earlier transform in the
chain already applied. The first middleware sees what the model asked
for; the last sees what the tool is about to receive.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/agent/middleware/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L209)

Conversation so far, including the assistant turn that made this call.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L211)

Multi-tenant run identity, when the run carried one.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:201](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L201)

ReAct iteration this call belongs to.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L213)

Abort signal from `run({ env: { signal } })`.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/middleware/types.ts:199](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L199)

Matches `stream.tool_start.toolCallId` for this dispatch.

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/middleware/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L185)

***

### toolSource?

> `readonly` `optional` **toolSource?**: `string`

Defined in: [src/core/agent/middleware/types.ts:197](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L197)

Where the tool being called came from — `Tool.source`, which `mcpClient`
fills with the server's name.

**Absent means the agent's own tool.** A name alone is not an identity: two
MCP servers may both serve a `call_aws`, and a policy matching the bare
name governs whichever one answers — including the one it was never written
about. With this, `call.toolSource === 'aws-prod'` is a rule that means what
it says, and `call.toolSource === undefined` is the honest way to spell
"something we wrote ourselves".
