---
title: TimeWall
---

# Interface: TimeWall

Defined in: src/core/time/reader.ts:110

A wall-clock time as the text wrote it — no zone.

## Properties

### clock?

> `readonly` `optional` **clock?**: `"24h"`

Defined in: src/core/time/reader.ts:121

`'24h'`: the text's FORM is a 24-hour clock (an ISO instant's
`T08:00`), so the hour is read as written — never also as pm. A form
fact the reader sees and `resolve.ts` cannot; absent, an hour 1–12 with
no meridiem is read both ways. Never with `meridiem`.

***

### h

> `readonly` **h**: `number`

Defined in: src/core/time/reader.ts:111

***

### m?

> `readonly` `optional` **m?**: `number`

Defined in: src/core/time/reader.ts:112

***

### meridiem?

> `readonly` `optional` **meridiem?**: `"am"` \| `"pm"`

Defined in: src/core/time/reader.ts:114

***

### s?

> `readonly` `optional` **s?**: `number`

Defined in: src/core/time/reader.ts:113
