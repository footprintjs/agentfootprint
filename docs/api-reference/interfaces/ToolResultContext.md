[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToolResultContext

# Interface: ToolResultContext

Defined in: [src/core/agent/middleware/types.ts:194](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L194)

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

Defined in: [src/core/agent/middleware/types.ts:177](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L177)

The args as THIS middleware sees them — every earlier transform in the
chain already applied. The first middleware sees what the model asked
for; the last sees what the tool is about to receive.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`args`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#args)

***

### error?

> `readonly` `optional` **error?**: `true`

Defined in: [src/core/agent/middleware/types.ts:206](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L206)

Present and `true` when the tool THREW and `result` is the error's
message. The call still executed, which is why this moment happens at
all: a tool that failed halfway may have done half its work.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [src/core/agent/middleware/types.ts:179](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L179)

Conversation so far, including the assistant turn that made this call.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`history`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#history)

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:181](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L181)

Multi-tenant run identity, when the run carried one.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`identity`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#identity)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L171)

ReAct iteration this call belongs to.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`iteration`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#iteration)

***

### result

> `readonly` **result**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:200](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L200)

What the tool returned. Whatever the tool's own return type is, un-
stringified — the conversion to the text the model reads happens after
this chain, so a rule can inspect the real object.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:183](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L183)

Abort signal from `run({ env: { signal } })`.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`signal`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#signal)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/middleware/types.ts:169](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L169)

Matches `stream.tool_start.toolCallId` for this dispatch.

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`toolCallId`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#toolcallid)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/middleware/types.ts:155](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L155)

#### Inherited from

[`ToolMiddlewareContext`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md).[`toolName`](/agentfootprint/api/generated/interfaces/ToolMiddlewareContext.md#toolname)

***

### toolSource?

> `readonly` `optional` **toolSource?**: `string`

Defined in: [src/core/agent/middleware/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/55ab6101a19749cb9a4b597db692af726c9bb431/src/core/agent/middleware/types.ts#L167)

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
