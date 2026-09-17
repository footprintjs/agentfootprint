---
title: ColumnType
---

# Type Alias: ColumnType

> **ColumnType** = `"number"` \| `"string"` \| `"boolean"` \| `"date"`

Defined in: [src/integrity/column-types/types.ts:46](https://github.com/footprintjs/agentfootprint/blob/main/src/integrity/column-types/types.ts#L46)

What a declared column holds.

| word | what a value must be |
| --- | --- |
| `number` | a JavaScript number that is FINITE — `NaN` and the infinities are a number that means "no number", and a chart handed one draws nothing |
| `string` | a JavaScript string, including the empty one (emptiness is meaning, and meaning is above this check's ceiling) |
| `boolean` | `true` or `false` — never `'true'`, never `0`, never `1` |
| `date` | a valid `Date` instance, or a string `Date.parse` accepts (an epoch NUMBER is a `number`; say so and the axis picker stops guessing) |
