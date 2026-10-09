---
title: NormaliseOptions
---

# Interface: NormaliseOptions

Defined in: src/core/time/axis.ts:320

Options of [normaliseInstants](/docs/api/functions/normaliseInstants).

## Properties

### naive?

> `readonly` `optional` **naive?**: [`NaiveValues`](/docs/api/type-aliases/NaiveValues)

Defined in: src/core/time/axis.ts:324

A value whose clock is unknown (naive, or a fall-back wall time the row
 order cannot place): `'flag'` counts it and reads the rest; `'refuse'`
 places nothing. Never read as UTC either way. Default `'flag'`.
