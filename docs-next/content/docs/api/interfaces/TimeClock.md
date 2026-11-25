---
title: TimeClock
---

# Interface: TimeClock

Defined in: [src/time/clock.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L58)

The run's clock, stamped once per turn (time design § 4).

## Extended by

- [`ClockRow`](/docs/api/interfaces/ClockRow)

## Properties

### now

> `readonly` **now**: `string`

Defined in: [src/time/clock.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L60)

The anchor for this turn — the app's `now`, else the turn's start.

***

### nowSource

> `readonly` **nowSource**: `"default"` \| `"app"`

Defined in: [src/time/clock.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L62)

The app passed `now`, or the library took the turn's start.

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/clock.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L68)

The person's zone for this run — an IANA name. Under `zoneSource:
'unknown'` it is `'UTC'`: the zone instants are SPELLED in, never the
person's.

***

### zoneSource

> `readonly` **zoneSource**: `"unknown"` \| `"run"` \| `"answered"` \| `"builder"`

Defined in: [src/time/clock.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L74)

The run's `time.zone`, else the `.time({ zone })` fallback; with neither,
the zone the person answered in an earlier turn of this conversation
(`'answered'`), else `'unknown'` (G15).
