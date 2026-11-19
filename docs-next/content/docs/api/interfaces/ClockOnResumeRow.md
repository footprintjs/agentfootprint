---
title: ClockOnResumeRow
---

# Interface: ClockOnResumeRow

Defined in: [src/time/rows/types.ts:30](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L30)

A resume passed a `time` that differs from the frozen clock: recorded, not applied (TQ21).

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L34)

The iteration the paused batch ran in.

***

### kept

> `readonly` **kept**: `object`

Defined in: [src/time/rows/types.ts:38](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L38)

The frozen clock's values the passed ones would have replaced.

#### now

> `readonly` **now**: `string`

#### window?

> `readonly` `optional` **window?**: [`TimeRange`](/docs/api/interfaces/TimeRange)

#### zone

> `readonly` **zone**: `string`

***

### kind

> `readonly` **kind**: `"clock-on-resume"`

Defined in: [src/time/rows/types.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L31)

***

### passed

> `readonly` **passed**: `ReadRunTime`

Defined in: [src/time/rows/types.ts:36](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L36)

What the resume passed, as read (values as written, a `Date` spelled in UTC).

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:32](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L32)
