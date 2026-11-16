---
title: AxisPoint
---

# Interface: AxisPoint

Defined in: [src/time/axis.ts:281](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L281)

One placed value: the row it came from and its UTC instant.

## Properties

### at

> `readonly` **at**: `string`

Defined in: [src/time/axis.ts:286](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L286)

The instant in UTC (`Z`), at the view's one precision — so comparing two
 spellings as text compares them in time.

***

### row

> `readonly` **row**: `number`

Defined in: [src/time/axis.ts:283](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L283)

The row's index in the rows as stored.
