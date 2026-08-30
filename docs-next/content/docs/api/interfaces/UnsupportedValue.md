---
title: UnsupportedValue
---

# Interface: UnsupportedValue

Defined in: [src/core/agent/evidence/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L103)

One value in the answer that no tool result carried.

## Properties

### shape

> `readonly` **shape**: `string`

Defined in: [src/core/agent/evidence/types.ts:108](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L108)

Which rule made it a candidate: `'identifier'`, `'number'`, or the name
 of a declared [EvidenceShape](/docs/api/interfaces/EvidenceShape).

***

### value

> `readonly` **value**: `string`

Defined in: [src/core/agent/evidence/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L105)

The value as it appeared in the answer, normalized and truncated.
