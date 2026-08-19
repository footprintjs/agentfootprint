[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolResultContext

# Interface: ToolResultContext

Defined in: [src/core/agent/middleware/types.ts:202](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L202)

The finished call `onToolResult` is deciding about: everything `onToolCall`
saw, plus what came back.

`args` here are the args the tool ACTUALLY RAN WITH — every before-transform
applied — so a rule reading both fields is reading one coherent event rather
than the model's proposal beside somebody else's answer.

## Extends

- [`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md)

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/agent/middleware/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L185)

The args as THIS middleware sees them — every earlier transform in the
chain already applied. The first middleware sees what the model asked
for; the last sees what the tool is about to receive.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`args`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#args)

***

### error?

> `readonly` `optional` **error?**: `true`

Defined in: [src/core/agent/middleware/types.ts:214](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L214)

Present and `true` when the tool THREW and `result` is the error's
message. The call still executed, which is why this moment happens at
all: a tool that failed halfway may have done half its work.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/middleware/types.ts:187](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L187)

Conversation so far, including the assistant turn that made this call.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`history`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#history)

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:189](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L189)

Multi-tenant run identity, when the run carried one.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`identity`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#identity)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L179)

ReAct iteration this call belongs to.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`iteration`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#iteration)

***

### result

> `readonly` **result**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:208](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L208)

What the tool returned. Whatever the tool's own return type is, un-
stringified — the conversion to the text the model reads happens after
this chain, so a rule can inspect the real object.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:191](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L191)

Abort signal from `run({ env: { signal } })`.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`signal`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#signal)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/middleware/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L177)

Matches `stream.tool_start.toolCallId` for this dispatch.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`toolCallId`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#toolcallid)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/middleware/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L163)

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`toolName`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#toolname)

***

### toolSource?

> `readonly` `optional` **toolSource?**: `string`

Defined in: [src/core/agent/middleware/types.ts:175](https://github.com/footprintjs/agentfootprint/blob/add0815e3417d934797433808004882c515e7ba6/src/core/agent/middleware/types.ts#L175)

Where the tool being called came from — `Tool.source`, which `mcpClient`
fills with the server's name.

**Absent means the agent's own tool.** A name alone is not an identity: two
MCP servers may both serve a `call_aws`, and a policy matching the bare
name governs whichever one answers — including the one it was never written
about. With this, `call.toolSource === 'aws-prod'` is a rule that means what
it says, and `call.toolSource === undefined` is the honest way to spell
"something we wrote ourselves".

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`toolSource`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#toolsource)
