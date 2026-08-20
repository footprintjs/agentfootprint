[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / placedResultKind

# Function: placedResultKind()

> **placedResultKind**(`toolName`): `string`

Defined in: [src/artifacts/placement.ts:81](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/artifacts/placement.ts#L81)

The kind vocabulary a placement mint declares: `tool-result/<toolName>`.
 Honest — it says exactly what the payload is and which tool produced it —
 and it is what a `wants` declaration or a `present` call names to consume
 the placed result.

## Parameters

### toolName

`string`

## Returns

`string`
