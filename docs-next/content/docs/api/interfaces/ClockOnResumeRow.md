---
title: ClockOnResumeRow
---

# Interface: ClockOnResumeRow

Defined in: [src/core/time/rows.ts:66](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L66)

A resume passed a `time` that differs from the frozen clock: recorded, not applied (TQ21).

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/time/rows.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L70)

The iteration the paused batch ran in.

***

### kept

> `readonly` **kept**: `object`

Defined in: [src/core/time/rows.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L74)

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

Defined in: [src/core/time/rows.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L67)

***

### passed

> `readonly` **passed**: `ReadRunTime`

Defined in: [src/core/time/rows.ts:72](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L72)

What the resume passed, as read (values as written, a `Date` spelled in UTC).

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/time/rows.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L68)
