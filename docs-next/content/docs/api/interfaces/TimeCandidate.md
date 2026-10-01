---
title: TimeCandidate
---

# Interface: TimeCandidate

Defined in: [src/core/time/resolveRecord.ts:118](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L118)

One candidate — produced here, never by a strategy.

## Extends

- [`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow)

## Properties

### anchor

> `readonly` **anchor**: `"none"` \| `"message"` \| `"previous-window"`

Defined in: [src/core/time/resolveRecord.ts:112](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L112)

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`anchor`](/docs/api/interfaces/ResolvedWindow#anchor)

***

### grain

> `readonly` **grain**: `Grain`

Defined in: [src/core/time/resolveRecord.ts:107](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L107)

The finest part the person said.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`grain`](/docs/api/interfaces/ResolvedWindow#grain)

***

### implied

> `readonly` **implied**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolveRecord.ts:111](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L111)

The parts this module filled: from the clock, the policy's candidates, the century.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`implied`](/docs/api/interfaces/ResolvedWindow#implied)

***

### notes

> `readonly` **notes**: readonly [`TimeNote`](/docs/api/type-aliases/TimeNote)[]

Defined in: [src/core/time/resolveRecord.ts:114](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L114)

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`notes`](/docs/api/interfaces/ResolvedWindow#notes)

***

### parse

> `readonly` **parse**: `number`

Defined in: [src/core/time/resolveRecord.ts:121](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L121)

Which of the mention's parses it came from.

***

### range

> `readonly` **range**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/core/time/resolveRecord.ts:103](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L103)

Always present: a look-back resolved against the clock. Spelled in the offset the person meant.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`range`](/docs/api/interfaces/ResolvedWindow#range)

***

### reader

> `readonly` **reader**: `object`

Defined in: [src/core/time/resolveRecord.ts:113](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L113)

#### id

> `readonly` **id**: `string`

#### kind

> `readonly` **kind**: `"model"` \| `"rule"`

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`reader`](/docs/api/interfaces/ResolvedWindow#reader)

***

### reading

> `readonly` **reading**: [`ReadingTags`](/docs/api/interfaces/ReadingTags)

Defined in: [src/core/time/resolveRecord.ts:119](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L119)

***

### said

> `readonly` **said**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolveRecord.ts:109](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L109)

The parts the person said — empty for a `model` reader's reading (§ 5.5).

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`said`](/docs/api/interfaces/ResolvedWindow#said)

***

### window

> `readonly` **window**: [`TimeWindow`](/docs/api/type-aliases/TimeWindow)

Defined in: [src/core/time/resolveRecord.ts:101](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L101)

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`window`](/docs/api/interfaces/ResolvedWindow#window)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/core/time/resolveRecord.ts:105](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L105)

The zone the person meant, else the clock's.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`zone`](/docs/api/interfaces/ResolvedWindow#zone)
