[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolMiddlewareContext

# Interface: ToolMiddlewareContext

Defined in: [src/core/agent/middleware/types.ts:154](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/middleware/types.ts#L154)

The call a tool middleware is deciding about.

## Extended by

- [`ToolResultContext`](/agentfootprint/api/generated/interfaces/ToolResultContext.md)

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/agent/middleware/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/middleware/types.ts#L177)

The args as THIS middleware sees them — every earlier transform in the
chain already applied. The first middleware sees what the model asked
for; the last sees what the tool is about to receive.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/middleware/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/middleware/types.ts#L179)

Conversation so far, including the assistant turn that made this call.

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/middleware/types.ts#L181)

Multi-tenant run identity, when the run carried one.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/middleware/types.ts#L171)

ReAct iteration this call belongs to.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/middleware/types.ts#L183)

Abort signal from `run({ env: { signal } })`.

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/middleware/types.ts:169](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/middleware/types.ts#L169)

Matches `stream.tool_start.toolCallId` for this dispatch.

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/middleware/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/middleware/types.ts#L155)

***

### toolSource?

> `readonly` `optional` **toolSource?**: `string`

Defined in: [src/core/agent/middleware/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/be5638d33f96d88c50c8291cfa2f28b6eeda5398/src/core/agent/middleware/types.ts#L167)

Where the tool being called came from — `Tool.source`, which `mcpClient`
fills with the server's name.

**Absent means the agent's own tool.** A name alone is not an identity: two
MCP servers may both serve a `call_aws`, and a policy matching the bare
name governs whichever one answers — including the one it was never written
about. With this, `call.toolSource === 'aws-prod'` is a rule that means what
it says, and `call.toolSource === undefined` is the honest way to spell
"something we wrote ourselves".
