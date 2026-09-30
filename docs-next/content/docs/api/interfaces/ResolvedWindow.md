---
title: ResolvedWindow
---

# Interface: ResolvedWindow

Defined in: [src/core/time/resolveRecord.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L78)

A window read from words, resolved against the clock (§ 3.2).

## Extended by

- [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)

## Properties

### anchor

> `readonly` **anchor**: `"none"` \| `"message"` \| `"previous-window"`

Defined in: [src/core/time/resolveRecord.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L90)

***

### grain

> `readonly` **grain**: `Grain`

Defined in: [src/core/time/resolveRecord.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L85)

The finest part the person said.

***

### implied

> `readonly` **implied**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolveRecord.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L89)

The parts this module filled: from the clock, the policy's candidates, the century.

***

### notes

> `readonly` **notes**: readonly [`TimeNote`](/docs/api/type-aliases/TimeNote)[]

Defined in: [src/core/time/resolveRecord.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L92)

***

### range

> `readonly` **range**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/core/time/resolveRecord.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L81)

Always present: a look-back resolved against the clock. Spelled in the offset the person meant.

***

### reader

> `readonly` **reader**: `object`

Defined in: [src/core/time/resolveRecord.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L91)

#### id

> `readonly` **id**: `string`

#### kind

> `readonly` **kind**: `"model"` \| `"rule"`

***

### said

> `readonly` **said**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolveRecord.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L87)

The parts the person said — empty for a `model` reader's reading (§ 5.5).

***

### window

> `readonly` **window**: [`TimeWindow`](/docs/api/type-aliases/TimeWindow)

Defined in: [src/core/time/resolveRecord.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L79)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/core/time/resolveRecord.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L83)

The zone the person meant, else the clock's.
