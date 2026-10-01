---
title: TimeDate
---

# Type Alias: TimeDate

> **TimeDate** = \{ `fields`: readonly `number`[]; `kind`: `"numeric"`; `yearDigits?`: `2` \| `4`; \} \| \{ `day`: `number`; `kind`: `"fixed"`; `month`: `number`; `year?`: `number`; \}

Defined in: src/core/time/reader.ts:98

A date as the text wrote it.

## Union Members

### Type Literal

\{ `fields`: readonly `number`[]; `kind`: `"numeric"`; `yearDigits?`: `2` \| `4`; \}

`'10/09/26'` → `fields: [10, 9, 26]` — the ORDER is not decided by the reader. Two or three fields.

***

### Type Literal

\{ `day`: `number`; `kind`: `"fixed"`; `month`: `number`; `year?`: `number`; \}

ISO or a named month: the text fixes the order.
