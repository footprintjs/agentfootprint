[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ThinkingState

# Interface: ThinkingState

Defined in: [agentfootprint/src/recorders/observability/thinking/thinkingTemplates.ts:53](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/thinking/thinkingTemplates.ts#L53)

What the selector returns. The chat-bubble consumer feeds this into
the renderer to get the final string.

## Properties

### state

> `readonly` **state**: [`ThinkingStateKind`](/agentfootprint/api/generated/type-aliases/ThinkingStateKind.md)

Defined in: [agentfootprint/src/recorders/observability/thinking/thinkingTemplates.ts:54](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/thinking/thinkingTemplates.ts#L54)

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [agentfootprint/src/recorders/observability/thinking/thinkingTemplates.ts:59](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/thinking/thinkingTemplates.ts#L59)

When `state === 'tool'`, the resolving toolName. The renderer
 uses this to look up `tool.<toolName>` before the generic `tool`.

***

### vars

> `readonly` **vars**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [agentfootprint/src/recorders/observability/thinking/thinkingTemplates.ts:56](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/observability/thinking/thinkingTemplates.ts#L56)

Vars for `{{name}}` substitution in the matched template.
