---
title: UnsupportedValue
---

# Interface: UnsupportedValue

Defined in: [src/core/agent/evidence/types.ts:225](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L225)

One value in the answer that no tool result carried.

## Properties

### region?

> `readonly` `optional` **region?**: `"prose"` \| `"code"`

Defined in: [src/core/agent/evidence/types.ts:236](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L236)

Under `code: 'match'` only: `'code'` when every occurrence of the value is
inside a fenced block that matched no submission (checked as prose all the
same), `'prose'` otherwise. Absent under `'check'`.

***

### shape

> `readonly` **shape**: `string`

Defined in: [src/core/agent/evidence/types.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L230)

Which rule made it a candidate: `'identifier'`, `'number'`, or the name
 of a declared [EvidenceShape](/docs/api/interfaces/EvidenceShape).

***

### value

> `readonly` **value**: `string`

Defined in: [src/core/agent/evidence/types.ts:227](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/evidence/types.ts#L227)

The value as it appeared in the answer, normalized and truncated.
