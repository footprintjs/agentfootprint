---
title: ClockRow
---

# Interface: ClockRow

Defined in: src/core/time/rows.ts:58

The turn's clock stamp — one per turn (time design § 4).

## Extends

- [`TimeClock`](/docs/api/interfaces/TimeClock)

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: src/core/time/rows.ts:63

The iteration seed filed it at (1).

***

### kind

> `readonly` **kind**: `"clock"`

Defined in: src/core/time/rows.ts:59

***

### now

> `readonly` **now**: `string`

Defined in: src/core/time/clock.ts:53

The anchor for this turn — the app's `now`, else the turn's start.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`now`](/docs/api/interfaces/TimeClock#now)

***

### nowSource

> `readonly` **nowSource**: `"default"` \| `"app"`

Defined in: src/core/time/clock.ts:55

The app passed `now`, or the library took the turn's start.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`nowSource`](/docs/api/interfaces/TimeClock#nowsource)

***

### turn

> `readonly` **turn**: `number`

Defined in: src/core/time/rows.ts:61

`AgentState.turnNumber` when the row was filed — the conversation turn.

***

### window?

> `readonly` `optional` **window?**: [`ControlWindow`](/docs/api/interfaces/ControlWindow)

Defined in: src/core/time/rows.ts:65

The run's `time.window`, when it passed one.

***

### zone

> `readonly` **zone**: `string`

Defined in: src/core/time/clock.ts:57

The person's zone for this run — an IANA name.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`zone`](/docs/api/interfaces/TimeClock#zone)

***

### zoneSource

> `readonly` **zoneSource**: `"run"` \| `"builder"`

Defined in: src/core/time/clock.ts:59

The run's `time.zone`, else the `.time({ zone })` fallback.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`zoneSource`](/docs/api/interfaces/TimeClock#zonesource)
