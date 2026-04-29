[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMMessage

# Interface: LLMMessage

Defined in: [agentfootprint/src/adapters/types.ts:20](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L20)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:22](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L22)

***

### role

> `readonly` **role**: [`ContextRole`](/agentfootprint/api/generated/type-aliases/ContextRole.md)

Defined in: [agentfootprint/src/adapters/types.ts:21](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L21)

***

### toolCallId?

> `readonly` `optional` **toolCallId?**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:24](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L24)

For `role: 'tool'` — the tool_use id this result corresponds to.

***

### toolCalls?

> `readonly` `optional` **toolCalls?**: readonly `object`[]

Defined in: [agentfootprint/src/adapters/types.ts:35](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L35)

For `role: 'assistant'` only — the tool calls the LLM requested in this
turn. Required for providers (Anthropic, OpenAI) that need to round-trip
tool_use blocks across iterations: when the next `complete()` includes
a `role: 'tool'` message, the provider reconstructs the matching
`tool_use` block on the previous assistant turn from this field.
Empty array on text-only turns; undefined for non-assistant roles.

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:26](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L26)

For `role: 'tool'` — the tool name this result corresponds to.
