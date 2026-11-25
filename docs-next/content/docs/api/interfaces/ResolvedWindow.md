---
title: ResolvedWindow
---

# Interface: ResolvedWindow

Defined in: [src/time/resolveRecord.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L103)

A window read from words, resolved against the clock (§ 3.2).

## Extended by

- [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)

## Properties

### anchor

> `readonly` **anchor**: `"none"` \| `"message"` \| `"previous-window"`

Defined in: [src/time/resolveRecord.ts:116](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L116)

***

### endpoint?

> `readonly` `optional` **endpoint?**: `WindowEndpoint`

Defined in: [src/time/resolveRecord.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L107)

***

### grain

> `readonly` **grain**: `Grain`

Defined in: [src/time/resolveRecord.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L111)

The finest part the person said.

***

### implied

> `readonly` **implied**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/time/resolveRecord.ts:115](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L115)

The parts this module filled: from the clock, the policy's candidates, the century.

***

### notes

> `readonly` **notes**: readonly [`TimeNote`](/docs/api/type-aliases/TimeNote)[]

Defined in: [src/time/resolveRecord.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L118)

***

### range

> `readonly` **range**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/time/resolveRecord.ts:106](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L106)

Always present: a look-back resolved against the clock. Spelled in the offset the person meant.

***

### reader

> `readonly` **reader**: `object`

Defined in: [src/time/resolveRecord.ts:117](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L117)

#### id

> `readonly` **id**: `string`

#### kind

> `readonly` **kind**: `"model"` \| `"rule"`

***

### said

> `readonly` **said**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/time/resolveRecord.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L113)

The parts the person said — empty for a `model` reader's reading (§ 5.5).

***

### window

> `readonly` **window**: [`TimeWindow`](/docs/api/type-aliases/TimeWindow)

Defined in: [src/time/resolveRecord.ts:104](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L104)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/time/resolveRecord.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/time/resolveRecord.ts#L109)

The zone the person meant, else the clock's.
