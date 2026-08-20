[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / placedResultKind

# Function: placedResultKind()

> **placedResultKind**(`toolName`): `string`

Defined in: [src/artifacts/placement.ts:81](https://github.com/footprintjs/agentfootprint/blob/0f601a8e26f97aefad58718776b96f7784728635/src/artifacts/placement.ts#L81)

The kind vocabulary a placement mint declares: `tool-result/<toolName>`.
 Honest — it says exactly what the payload is and which tool produced it —
 and it is what a `wants` declaration or a `present` call names to consume
 the placed result.

## Parameters

### toolName

`string`

## Returns

`string`
