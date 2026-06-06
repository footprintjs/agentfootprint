[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StatusState

# Interface: StatusState

Defined in: [src/recorders/observability/thinking/thinkingTemplates.ts:53](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/thinking/thinkingTemplates.ts#L53)

What the selector returns. The chat-bubble consumer feeds this into
the renderer to get the final string.

## Properties

### state

> `readonly` **state**: [`StatusKind`](/agentfootprint/api/generated/type-aliases/StatusKind.md)

Defined in: [src/recorders/observability/thinking/thinkingTemplates.ts:54](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/thinking/thinkingTemplates.ts#L54)

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/recorders/observability/thinking/thinkingTemplates.ts:59](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/thinking/thinkingTemplates.ts#L59)

When `state === 'tool'`, the resolving toolName. The renderer
 uses this to look up `tool.<toolName>` before the generic `tool`.

***

### vars

> `readonly` **vars**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/recorders/observability/thinking/thinkingTemplates.ts:56](https://github.com/footprintjs/agentfootprint/blob/4291689137009e2faa45aef8799595736047b70f/src/recorders/observability/thinking/thinkingTemplates.ts#L56)

Vars for `{{name}}` substitution in the matched template.
