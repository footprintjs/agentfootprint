---
title: AxisOverlapNote
---

# Interface: AxisOverlapNote

Defined in: [src/time/axis.ts:290](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L290)

A value the fall-back overlap doubled, placed by the rows' order.

## Properties

### kind

> `readonly` **kind**: `"dst-overlap"`

Defined in: [src/time/axis.ts:291](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L291)

***

### resolvedBy

> `readonly` **resolvedBy**: `"row-order"`

Defined in: [src/time/axis.ts:292](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L292)

***

### row

> `readonly` **row**: `number`

Defined in: [src/time/axis.ts:293](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L293)

***

### which

> `readonly` **which**: `"earlier"` \| `"later"`

Defined in: [src/time/axis.ts:295](https://github.com/footprintjs/agentfootprint/blob/main/src/time/axis.ts#L295)

Which of the two instants the wall time names: before the clock stepped back, or after.
