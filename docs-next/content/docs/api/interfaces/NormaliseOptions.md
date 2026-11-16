---
title: NormaliseOptions
---

# Interface: NormaliseOptions

Defined in: [src/time/axis.ts:270](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L270)

Options of [normaliseInstants](/docs/api/functions/normaliseInstants).

## Properties

### naive?

> `readonly` `optional` **naive?**: [`NaiveValues`](/docs/api/type-aliases/NaiveValues)

Defined in: [src/time/axis.ts:274](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L274)

A value whose clock is unknown (naive, or a fall-back wall time the row
 order cannot place): `'flag'` counts it and reads the rest; `'refuse'`
 places nothing. Never read as UTC either way. Default `'flag'`.
