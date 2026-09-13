---
title: ColumnViolation
---

# Interface: ColumnViolation

Defined in: src/integrity/column-types/check.ts:140

One declared column the rows disagreed with.

## Properties

### column

> `readonly` **column**: `string`

Defined in: src/integrity/column-types/check.ts:141

***

### declared

> `readonly` **declared**: [`ColumnType`](/docs/api/type-aliases/ColumnType)

Defined in: src/integrity/column-types/check.ts:142

***

### got

> `readonly` **got**: `string`

Defined in: src/integrity/column-types/check.ts:150

What that first offending value actually is (`string`, `null`, `missing`, …).

***

### ofRows

> `readonly` **ofRows**: `number`

Defined in: src/integrity/column-types/check.ts:146

Total rows read, so a reader can see 3-of-4 rather than a bare 3.

***

### rows

> `readonly` **rows**: `number`

Defined in: src/integrity/column-types/check.ts:144

How many rows hold something that is not the declared type.

***

### sample

> `readonly` **sample**: `string`

Defined in: src/integrity/column-types/check.ts:148

The first offending value, rendered and clipped — what a person recognizes.
