---
title: ToolResultContext
---

# Interface: ToolResultContext

Defined in: [src/core/agent/middleware/types.ts:224](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L224)

The finished call `onToolResult` is deciding about: everything `onToolCall`
saw, plus what came back.

`args` here are the args the tool ACTUALLY RAN WITH — every before-transform
applied — so a rule reading both fields is reading one coherent event rather
than the model's proposal beside somebody else's answer.

## Extends

- [`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext)

## Properties

### args

> `readonly` **args**: `Readonly`\<`Record`\<`string`, `unknown`\>\>

Defined in: [src/core/agent/middleware/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L207)

The args as THIS middleware sees them — every earlier transform in the
chain already applied. The first middleware sees what the model asked
for; the last sees what the tool is about to receive.

#### Inherited from

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext).[`args`](/docs/api/interfaces/ToolMiddlewareContext#args)

***

### error?

> `readonly` `optional` **error?**: `true`

Defined in: [src/core/agent/middleware/types.ts:236](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L236)

Present and `true` when the tool THREW and `result` is the error's
message. The call still executed, which is why this moment happens at
all: a tool that failed halfway may have done half its work.

***

### history

> `readonly` **history**: readonly [`LLMMessage`](/docs/api/interfaces/LLMMessage)[]

Defined in: [src/core/agent/middleware/types.ts:209](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L209)

Conversation so far, including the assistant turn that made this call.

#### Inherited from

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext).[`history`](/docs/api/interfaces/ToolMiddlewareContext#history)

***

### identity?

> `readonly` `optional` **identity?**: `MemoryIdentity`

Defined in: [src/core/agent/middleware/types.ts:211](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L211)

Multi-tenant run identity, when the run carried one.

#### Inherited from

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext).[`identity`](/docs/api/interfaces/ToolMiddlewareContext#identity)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/middleware/types.ts:201](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L201)

ReAct iteration this call belongs to.

#### Inherited from

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext).[`iteration`](/docs/api/interfaces/ToolMiddlewareContext#iteration)

***

### knownNames?

> `readonly` `optional` **knownNames?**: `KnownNames`

Defined in: [src/core/agent/middleware/types.ts:245](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L245)

The names an `absent({ among: { …, visible: 'caller' } })` read for the
caller — handed BESIDE the result, never inside it (`result` holds no
name). As an earlier rule left them. This rule decides what the model
reads of them: pass through (`allow()`) keeps them; `allow(value, why)`
drops them unless it says `{ knownNames }`; `deny` drops them. Absent
when the result carries none.

***

### result

> `readonly` **result**: `unknown`

Defined in: [src/core/agent/middleware/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L230)

What the tool returned. Whatever the tool's own return type is, un-
stringified — the conversion to the text the model reads happens after
this chain, so a rule can inspect the real object.

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [src/core/agent/middleware/types.ts:213](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L213)

Abort signal from `run({ env: { signal } })`.

#### Inherited from

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext).[`signal`](/docs/api/interfaces/ToolMiddlewareContext#signal)

***

### toolCallId

> `readonly` **toolCallId**: `string`

Defined in: [src/core/agent/middleware/types.ts:199](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L199)

Matches `stream.tool_start.toolCallId` for this dispatch.

#### Inherited from

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext).[`toolCallId`](/docs/api/interfaces/ToolMiddlewareContext#toolcallid)

***

### toolName

> `readonly` **toolName**: `string`

Defined in: [src/core/agent/middleware/types.ts:185](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/middleware/types.ts#L185)

#### Inherited from

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext).[`toolName`](/docs/api/interfaces/ToolMiddlewareContext#toolname)

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

#### Inherited from

[`ToolMiddlewareContext`](/docs/api/interfaces/ToolMiddlewareContext).[`toolSource`](/docs/api/interfaces/ToolMiddlewareContext#toolsource)
