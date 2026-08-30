---
title: LookupResultReading
---

# Interface: LookupResultReading

Defined in: [src/integrity/empty-lookup/check.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/empty-lookup/check.ts#L78)

What the library could read about a finished lookup's result.

## Properties

### empty

> `readonly` **empty**: `boolean`

Defined in: [src/integrity/empty-lookup/check.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/empty-lookup/check.ts#L81)

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: [src/integrity/empty-lookup/check.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/empty-lookup/check.ts#L83)

Rows counted, for a rowset. Absent for an absence, which declares itself.

***

### shape

> `readonly` **shape**: `"rowset"` \| `"absence"`

Defined in: [src/integrity/empty-lookup/check.ts:80](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/empty-lookup/check.ts#L80)

`'rowset'` — an array, counted. `'absence'` — the `absent()` envelope.
