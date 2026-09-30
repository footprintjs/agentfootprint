---
title: TimeCandidate
---

# Interface: TimeCandidate

Defined in: [src/core/time/resolveRecord.ts:96](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L96)

One candidate — produced here, never by a strategy.

## Extends

- [`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow)

## Properties

### anchor

> `readonly` **anchor**: `"none"` \| `"message"` \| `"previous-window"`

Defined in: [src/core/time/resolveRecord.ts:90](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L90)

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`anchor`](/docs/api/interfaces/ResolvedWindow#anchor)

***

### grain

> `readonly` **grain**: `Grain`

Defined in: [src/core/time/resolveRecord.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L85)

The finest part the person said.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`grain`](/docs/api/interfaces/ResolvedWindow#grain)

***

### implied

> `readonly` **implied**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolveRecord.ts:89](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L89)

The parts this module filled: from the clock, the policy's candidates, the century.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`implied`](/docs/api/interfaces/ResolvedWindow#implied)

***

### notes

> `readonly` **notes**: readonly [`TimeNote`](/docs/api/type-aliases/TimeNote)[]

Defined in: [src/core/time/resolveRecord.ts:92](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L92)

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`notes`](/docs/api/interfaces/ResolvedWindow#notes)

***

### parse

> `readonly` **parse**: `number`

Defined in: [src/core/time/resolveRecord.ts:99](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L99)

Which of the mention's parses it came from.

***

### range

> `readonly` **range**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/core/time/resolveRecord.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L81)

Always present: a look-back resolved against the clock. Spelled in the offset the person meant.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`range`](/docs/api/interfaces/ResolvedWindow#range)

***

### reader

> `readonly` **reader**: `object`

Defined in: [src/core/time/resolveRecord.ts:91](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L91)

#### id

> `readonly` **id**: `string`

#### kind

> `readonly` **kind**: `"model"` \| `"rule"`

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`reader`](/docs/api/interfaces/ResolvedWindow#reader)

***

### reading

> `readonly` **reading**: [`ReadingTags`](/docs/api/interfaces/ReadingTags)

Defined in: [src/core/time/resolveRecord.ts:97](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L97)

***

### said

> `readonly` **said**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolveRecord.ts:87](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L87)

The parts the person said — empty for a `model` reader's reading (§ 5.5).

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`said`](/docs/api/interfaces/ResolvedWindow#said)

***

### window

> `readonly` **window**: [`TimeWindow`](/docs/api/type-aliases/TimeWindow)

Defined in: [src/core/time/resolveRecord.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L79)

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`window`](/docs/api/interfaces/ResolvedWindow#window)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/core/time/resolveRecord.ts:83](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolveRecord.ts#L83)

The zone the person meant, else the clock's.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`zone`](/docs/api/interfaces/ResolvedWindow#zone)
