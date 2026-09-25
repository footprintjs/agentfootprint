[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / UnsupportedValue

# Interface: UnsupportedValue

Defined in: [src/core/agent/evidence/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L147)

One value in the answer that no tool result carried.

## Properties

### shape

> `readonly` **shape**: `string`

Defined in: [src/core/agent/evidence/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L152)

Which rule made it a candidate: `'identifier'`, `'number'`, or the name
 of a declared [EvidenceShape](/agentfootprint/api/generated/interfaces/EvidenceShape.md).

***

### value

> `readonly` **value**: `string`

Defined in: [src/core/agent/evidence/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/f5cabfd85eeae981c1a9a9dd20edaa7a4ced5063/src/core/agent/evidence/types.ts#L149)

The value as it appeared in the answer, normalized and truncated.
