---
title: ColumnDeclaration
---

# Interface: ColumnDeclaration

Defined in: [src/integrity/column-types/types.ts:52](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/column-types/types.ts#L52)

The object spelling of one column's declaration.

## Properties

### nullable?

> `readonly` `optional` **nullable?**: `boolean`

Defined in: [src/integrity/column-types/types.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/column-types/types.ts#L75)

`true` — a row of this column may legitimately carry NO VALUE (`null`,
`undefined`, or the key simply not set on that row), and such a row is
never a type violation.

Default `false`, and the default is the strict one ON PURPOSE. The field
failure this check is built from was a value that went missing and left
an empty string behind; had the same code left a `null` behind, the
defect would have been identical and a lenient default would have waved
it through. One word turns it off, and every finding names that word — so
a legitimate null column costs a one-word edit, while a silent default
would cost the bug.

`nullable` is a promise about VALUES. It is NOT a promise about the
column's existence: a declared column that appears in no row at all is a
`missing-column` finding whether or not it is nullable, because the
declaration named a column and the result has no such column. The valve
for "this column may or may not be there" is to not declare it —
unlisted columns are allowed and unjudged.

***

### type

> `readonly` **type**: [`ColumnType`](/docs/api/type-aliases/ColumnType)

Defined in: [src/integrity/column-types/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/column-types/types.ts#L54)

What the column holds.
