---
title: AxisOverlapNote
---

# Interface: AxisOverlapNote

Defined in: [src/core/time/axis.ts:340](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/axis.ts#L340)

A value the fall-back overlap doubled, placed by the rows' order.

## Properties

### kind

> `readonly` **kind**: `"dst-overlap"`

Defined in: [src/core/time/axis.ts:341](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/axis.ts#L341)

***

### resolvedBy

> `readonly` **resolvedBy**: `"row-order"`

Defined in: [src/core/time/axis.ts:342](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/axis.ts#L342)

***

### row

> `readonly` **row**: `number`

Defined in: [src/core/time/axis.ts:343](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/axis.ts#L343)

***

### which

> `readonly` **which**: `"earlier"` \| `"later"`

Defined in: [src/core/time/axis.ts:345](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/axis.ts#L345)

Which of the two instants the wall time names: before the clock stepped back, or after.
