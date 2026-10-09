---
title: TimeRange
---

# Interface: TimeRange

Defined in: [src/core/time/range.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/range.ts#L59)

The library's INTERNAL range: half-open `[from, to)`, `from` before `to`.
NOT the same reading as `DeclaredPeriod.queried`, whose bounds are
inclusive — every boundary converts (the module table).

## Extended by

- [`ControlWindow`](/docs/api/interfaces/ControlWindow)
- [`PersonWindow`](/docs/api/interfaces/PersonWindow)
- [`TimeAnswerRow`](/docs/api/interfaces/TimeAnswerRow)

## Properties

### from

> `readonly` **from**: `string`

Defined in: [src/core/time/range.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/range.ts#L60)

***

### to

> `readonly` **to**: `string`

Defined in: [src/core/time/range.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/range.ts#L61)
