---
title: TimeClock
---

# Interface: TimeClock

Defined in: src/core/time/clock.ts:51

The run's clock, stamped once per turn (time design § 4).

## Extended by

- [`ClockRow`](/docs/api/interfaces/ClockRow)

## Properties

### now

> `readonly` **now**: `string`

Defined in: src/core/time/clock.ts:53

The anchor for this turn — the app's `now`, else the turn's start.

***

### nowSource

> `readonly` **nowSource**: `"default"` \| `"app"`

Defined in: src/core/time/clock.ts:55

The app passed `now`, or the library took the turn's start.

***

### zone

> `readonly` **zone**: `string`

Defined in: src/core/time/clock.ts:57

The person's zone for this run — an IANA name.

***

### zoneSource

> `readonly` **zoneSource**: `"run"` \| `"builder"`

Defined in: src/core/time/clock.ts:59

The run's `time.zone`, else the `.time({ zone })` fallback.
