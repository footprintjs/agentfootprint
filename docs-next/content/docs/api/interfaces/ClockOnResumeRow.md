---
title: ClockOnResumeRow
---

# Interface: ClockOnResumeRow

Defined in: [src/core/time/rows.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L69)

A resume passed a `time` that differs from the frozen clock: recorded, not applied (TQ21).

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/time/rows.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L73)

The iteration the paused batch ran in.

***

### kept

> `readonly` **kept**: `object`

Defined in: [src/core/time/rows.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L77)

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

Defined in: [src/core/time/rows.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L70)

***

### passed

> `readonly` **passed**: `ReadRunTime`

Defined in: [src/core/time/rows.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L75)

What the resume passed, as read (values as written, a `Date` spelled in UTC).

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/core/time/rows.ts:71](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/rows.ts#L71)
