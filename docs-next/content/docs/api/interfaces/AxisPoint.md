---
title: AxisPoint
---

# Interface: AxisPoint

Defined in: src/core/time/axis.ts:331

One placed value: the row it came from and its UTC instant.

## Properties

### at

> `readonly` **at**: `string`

Defined in: src/core/time/axis.ts:336

The instant in UTC (`Z`), at the view's one precision — so comparing two
 spellings as text compares them in time.

***

### row

> `readonly` **row**: `number`

Defined in: src/core/time/axis.ts:333

The row's index in the rows as stored.
