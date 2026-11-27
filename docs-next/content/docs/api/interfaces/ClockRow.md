---
title: ClockRow
---

# Interface: ClockRow

Defined in: [src/time/rows/types.ts:20](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L20)

The turn's clock stamp — one per turn (time design § 4).

## Extends

- [`TimeClock`](/docs/api/interfaces/TimeClock)

## Properties

### display?

> `readonly` `optional` **display?**: `TimeDisplay`

Defined in: [src/time/rows/types.ts:22](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L22)

Reported viewer zone, explicitly excluded from interpretation.

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/time/rows/types.ts:27](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L27)

The iteration seed filed it at (1).

***

### kind

> `readonly` **kind**: `"clock"`

Defined in: [src/time/rows/types.ts:23](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L23)

***

### now

> `readonly` **now**: `string`

Defined in: [src/time/clock.ts:61](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L61)

The anchor for this turn — the app's `now`, else the turn's start.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`now`](/docs/api/interfaces/TimeClock#now)

***

### nowSource

> `readonly` **nowSource**: `"default"` \| `"app"`

Defined in: [src/time/clock.ts:63](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L63)

The app passed `now`, or the library took the turn's start.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`nowSource`](/docs/api/interfaces/TimeClock#nowsource)

***

### provenInputPosition?

> `readonly` `optional` **provenInputPosition?**: `number`

Defined in: [src/time/rows/types.ts:31](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L31)

The retained position of this turn's person-authored input, under the opt-in.

***

### turn

> `readonly` **turn**: `number`

Defined in: [src/time/rows/types.ts:25](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L25)

`AgentState.turnNumber` when the row was filed — the conversation turn.

***

### window?

> `readonly` `optional` **window?**: [`ControlWindow`](/docs/api/interfaces/ControlWindow)

Defined in: [src/time/rows/types.ts:29](https://github.com/footprintjs/agentfootprint/blob/main/src/time/rows/types.ts#L29)

The run's `time.window`, when it passed one.

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/clock.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L69)

The person's zone for this run — an IANA name. Under `zoneSource:
'unknown'` it is `'UTC'`: the zone instants are SPELLED in, never the
person's.

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`zone`](/docs/api/interfaces/TimeClock#zone)

***

### zoneSource

> `readonly` **zoneSource**: `"unknown"` \| `"run"` \| `"answered"` \| `"builder"`

Defined in: [src/time/clock.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/time/clock.ts#L75)

The run's `time.zone`, else the `.time({ zone })` fallback; with neither,
the zone the person answered in an earlier turn of this conversation
(`'answered'`), else `'unknown'` (G15).

#### Inherited from

[`TimeClock`](/docs/api/interfaces/TimeClock).[`zoneSource`](/docs/api/interfaces/TimeClock#zonesource)
