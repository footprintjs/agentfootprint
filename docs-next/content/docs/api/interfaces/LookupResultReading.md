---
title: LookupResultReading
---

# Interface: LookupResultReading

Defined in: src/integrity/empty-lookup/check.ts:78

What the library could read about a finished lookup's result.

## Properties

### empty

> `readonly` **empty**: `boolean`

Defined in: src/integrity/empty-lookup/check.ts:81

***

### rows?

> `readonly` `optional` **rows?**: `number`

Defined in: src/integrity/empty-lookup/check.ts:83

Rows counted, for a rowset. Absent for an absence, which declares itself.

***

### shape

> `readonly` **shape**: `"rowset"` \| `"absence"`

Defined in: src/integrity/empty-lookup/check.ts:80

`'rowset'` — an array, counted. `'absence'` — the `absent()` envelope.
