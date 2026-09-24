[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / TruncatedToolResult

# Interface: TruncatedToolResult

Defined in: [src/core/agent/toolResultCap.ts:59](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolResultCap.ts#L59)

The result a capped dispatch hands on — the marker IS the result.

Reaches the model as JSON on the `role: 'tool'` message, and reaches
`agentfootprint.stream.tool_end` as this object.

## Properties

### head?

> `readonly` `optional` **head?**: `string`

Defined in: [src/core/agent/toolResultCap.ts:72](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolResultCap.ts#L72)

The first characters of the real result, verbatim. Absent when the cap is
too small to afford any — see the head budget note above.

***

### reason

> `readonly` **reason**: `string`

Defined in: [src/core/agent/toolResultCap.ts:67](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolResultCap.ts#L67)

What happened, in the model's own reading order: which tool, how big, what
the cap was, and the one action that helps. Never carries the tool's
arguments or the omitted content.

***

### truncated

> `readonly` **truncated**: `true`

Defined in: [src/core/agent/toolResultCap.ts:61](https://github.com/footprintjs/agentfootprint/blob/8eb817f55f177662ed213c7b387a5bdc2527c87b/src/core/agent/toolResultCap.ts#L61)

Always `true`. The field a consumer branches on.
