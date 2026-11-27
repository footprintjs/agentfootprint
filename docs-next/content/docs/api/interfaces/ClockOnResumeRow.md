---
title: ClockOnResumeRow
---

# Interface: ClockOnResumeRow

Defined in: [src/time/rows/types.ts:33](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L33)

A resume passed a `time` that differs from the frozen clock: recorded, not applied (TQ21).

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:37](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L37)

The iteration the paused batch ran in.

***

### kept

> `readonly` **kept**: `object`

Defined in: [src/time/rows/types.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L41)

The frozen clock's values the passed ones would have replaced.

#### now

> `readonly` **now**: `string`

#### window?

> `readonly` `optional` **window?**: `RecordedWindow`

#### zone

> `readonly` **zone**: `string`

***

### kind

> `readonly` **kind**: `"clock-on-resume"`

Defined in: [src/time/rows/types.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L34)

***

### passed

> `readonly` **passed**: `ReadRunTime`

Defined in: [src/time/rows/types.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L39)

What the resume passed, as read (values as written, a `Date` spelled in UTC).

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L35)
