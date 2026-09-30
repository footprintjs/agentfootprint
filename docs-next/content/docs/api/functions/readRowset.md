---
title: readRowset
---

# Function: readRowset()

> **readRowset**(`value`): [`RowsetReading`](/docs/api/interfaces/RowsetReading) \| `undefined`

Defined in: [src/integrity/column-types/check.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/column-types/check.ts#L117)

READ a finished result as a rowset, or decline to.

The one readable shape, and why only this one: an ARRAY OF PLAIN OBJECTS
with at least one row. That is what a rowset is on this wire, it is what
every consumer named in the docs page already expects, and it is the same
`Array.isArray` law the neighbouring check reads by — the two must never
disagree about what a rowset is.

`undefined` (⇒ `not-applicable`, a ROW) for everything else:
  • a non-array — prose, a `null`, a `{ rows: [...] }` wrapper, a ticket;
  • an array holding anything that is not a plain object — a list of
    strings has no columns, and inventing some is how a checker starts
    lying;
  • an array of ZERO rows — an empty answer has no columns to be wrong
    about, and it is the neighbour's subject, not this one's.

## Parameters

### value

`unknown`

## Returns

[`RowsetReading`](/docs/api/interfaces/RowsetReading) \| `undefined`
