---
title: TimeClock
---

# Interface: TimeClock

Defined in: [src/time/clock.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L59)

The run's clock, stamped once per turn (time design § 4).

## Extended by

- [`ClockRow`](/docs/api/interfaces/ClockRow)

## Properties

### now

> `readonly` **now**: `string`

Defined in: [src/time/clock.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L61)

The anchor for this turn — the app's `now`, else the turn's start.

***

### nowSource

> `readonly` **nowSource**: `"default"` \| `"app"`

Defined in: [src/time/clock.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L63)

The app passed `now`, or the library took the turn's start.

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/clock.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L69)

The person's zone for this run — an IANA name. Under `zoneSource:
'unknown'` it is `'UTC'`: the zone instants are SPELLED in, never the
person's.

***

### zoneSource

> `readonly` **zoneSource**: `"unknown"` \| `"run"` \| `"answered"` \| `"builder"`

Defined in: [src/time/clock.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L75)

The run's `time.zone`, else the `.time({ zone })` fallback; with neither,
the zone the person answered in an earlier turn of this conversation
(`'answered'`), else `'unknown'` (G15).
