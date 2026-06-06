[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / StatusState

# Interface: StatusState

Defined in: [src/recorders/observability/status/statusTemplates.ts:53](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/observability/status/statusTemplates.ts#L53)

What the selector returns. The chat-bubble consumer feeds this into
the renderer to get the final string.

## Properties

### state

> `readonly` **state**: [`StatusKind`](/agentfootprint/api/generated/type-aliases/StatusKind.md)

Defined in: [src/recorders/observability/status/statusTemplates.ts:54](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/observability/status/statusTemplates.ts#L54)

***

### toolName?

> `readonly` `optional` **toolName?**: `string`

Defined in: [src/recorders/observability/status/statusTemplates.ts:59](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/observability/status/statusTemplates.ts#L59)

When `state === 'tool'`, the resolving toolName. The renderer
 uses this to look up `tool.<toolName>` before the generic `tool`.

***

### vars

> `readonly` **vars**: `Readonly`\<`Record`\<`string`, `string`\>\>

Defined in: [src/recorders/observability/status/statusTemplates.ts:56](https://github.com/footprintjs/agentfootprint/blob/d1cb45510740421f2b84b6de9f852a72e94bb106/src/recorders/observability/status/statusTemplates.ts#L56)

Vars for `{{name}}` substitution in the matched template.
