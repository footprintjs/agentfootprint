---
title: ClockRow
---

# Interface: ClockRow

Defined in: [src/time/rows/types.ts:19](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L19)

The turn's clock stamp — one per turn (time design § 4).

## Extends

- [`TimeClock`](/docs/api/interfaces/TimeClock)

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:24](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L24)

The iteration seed filed it at (1).

***

### kind

> `readonly` **kind**: `"clock"`

Defined in: [src/time/rows/types.ts:20](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L20)

***

### now

> `readonly` **now**: `string`

Defined in: [src/time/clock.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L60)

The anchor for this turn — the app's `now`, else the turn's start.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`now`](/docs/api/interfaces/TimeClock#now)

***

### nowSource

> `readonly` **nowSource**: `"default"` \| `"app"`

Defined in: [src/time/clock.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L62)

The app passed `now`, or the library took the turn's start.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`nowSource`](/docs/api/interfaces/TimeClock#nowsource)

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:22](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L22)

`AgentState.turnNumber` when the row was filed — the conversation turn.

***

### window?

> `readonly` `optional` **window?**: [`ControlWindow`](/docs/api/interfaces/ControlWindow)

Defined in: [src/time/rows/types.ts:26](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L26)

The run's `time.window`, when it passed one.

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/clock.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L68)

The person's zone for this run — an IANA name. Under `zoneSource:
'unknown'` it is `'UTC'`: the zone instants are SPELLED in, never the
person's.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`zone`](/docs/api/interfaces/TimeClock#zone)

***

### zoneSource

> `readonly` **zoneSource**: `"unknown"` \| `"run"` \| `"answered"` \| `"builder"`

Defined in: [src/time/clock.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L74)

The run's `time.zone`, else the `.time({ zone })` fallback; with neither,
the zone the person answered in an earlier turn of this conversation
(`'answered'`), else `'unknown'` (G15).

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`zoneSource`](/docs/api/interfaces/TimeClock#zonesource)
