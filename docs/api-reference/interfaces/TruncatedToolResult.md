[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / TruncatedToolResult

# Interface: TruncatedToolResult

Defined in: [src/core/agent/toolResultCap.ts:56](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolResultCap.ts#L56)

The result a capped dispatch hands on — the marker IS the result.

Reaches the model as JSON on the `role: 'tool'` message, and reaches
`agentfootprint.stream.tool_end` as this object.

## Properties

### head?

> `readonly` `optional` **head?**: `string`

Defined in: [src/core/agent/toolResultCap.ts:69](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolResultCap.ts#L69)

The first characters of the real result, verbatim. Absent when the cap is
too small to afford any — see the head budget note above.

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/agent/toolResultCap.ts:64](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolResultCap.ts#L64)

What happened, in the model's own reading order: which tool, how big, what
the cap was, and the one action that helps. Never carries the tool's
arguments or the omitted content.

***

### truncated

> `readonly` **truncated**: `true`

Defined in: [src/core/agent/toolResultCap.ts:58](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/core/agent/toolResultCap.ts#L58)

Always `true`. The field a consumer branches on.
