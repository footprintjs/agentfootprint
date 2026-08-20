[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / UnsupportedValue

# Interface: UnsupportedValue

Defined in: [src/core/agent/evidence/types.ts:82](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/evidence/types.ts#L82)

One value in the answer that no tool result carried.

## Properties

### shape

> `readonly` **shape**: `string`

Defined in: [src/core/agent/evidence/types.ts:87](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/evidence/types.ts#L87)

Which rule made it a candidate: `'identifier'`, `'number'`, or the name
 of a declared [EvidenceShape](/agentfootprint/api/generated/interfaces/EvidenceShape.md).

***

### value

> `readonly` **value**: `string`

Defined in: [src/core/agent/evidence/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/bf2bb6032a7a77012e83dd190bf46141ff4a3215/src/core/agent/evidence/types.ts#L84)

The value as it appeared in the answer, normalized and truncated.
