---
title: TimeClock
---

# Interface: TimeClock

Defined in: [src/core/time/clock.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L54)

The run's clock, stamped once per turn (time design § 4).

## Extended by

- [`ClockRow`](/docs/api/interfaces/ClockRow)

## Properties

### now

> `readonly` **now**: `string`

Defined in: [src/core/time/clock.ts:56](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L56)

The anchor for this turn — the app's `now`, else the turn's start.

***

### nowSource

> `readonly` **nowSource**: `"default"` \| `"app"`

Defined in: [src/core/time/clock.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L58)

The app passed `now`, or the library took the turn's start.

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/core/time/clock.ts:64](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L64)

The person's zone for this run — an IANA name. Under `zoneSource:
'unknown'` it is `'UTC'`: the zone instants are SPELLED in, never the
person's.

***

### zoneSource

> `readonly` **zoneSource**: `"unknown"` \| `"run"` \| `"answered"` \| `"builder"`

Defined in: [src/core/time/clock.ts:70](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/clock.ts#L70)

The run's `time.zone`, else the `.time({ zone })` fallback; with neither,
the zone the person answered in an earlier turn of this conversation
(`'answered'`), else `'unknown'` (G15).
