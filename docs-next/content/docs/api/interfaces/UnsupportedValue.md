---
title: UnsupportedValue
---

# Interface: UnsupportedValue

Defined in: [src/core/agent/evidence/types.ts:205](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L205)

One value in the answer that no tool result carried.

## Properties

### shape

> `readonly` **shape**: `string`

Defined in: [src/core/agent/evidence/types.ts:210](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L210)

Which rule made it a candidate: `'identifier'`, `'number'`, or the name
 of a declared [EvidenceShape](/docs/api/interfaces/EvidenceShape).

***

### value

> `readonly` **value**: `string`

Defined in: [src/core/agent/evidence/types.ts:207](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L207)

The value as it appeared in the answer, normalized and truncated.
