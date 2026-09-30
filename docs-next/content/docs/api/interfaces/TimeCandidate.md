---
title: TimeCandidate
---

# Interface: TimeCandidate

Defined in: [src/core/time/resolve.ts:144](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L144)

One candidate — produced here, never by a strategy.

## Extends

- [`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow)

## Properties

### anchor

> `readonly` **anchor**: `"none"` \| `"message"` \| `"previous-window"`

Defined in: [src/core/time/resolve.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L138)

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`anchor`](/docs/api/interfaces/ResolvedWindow#anchor)

***

### grain

> `readonly` **grain**: `Grain`

Defined in: [src/core/time/resolve.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L133)

The finest part the person said.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`grain`](/docs/api/interfaces/ResolvedWindow#grain)

***

### implied

> `readonly` **implied**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolve.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L137)

The parts this module filled: from the clock, the policy's candidates, the century.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`implied`](/docs/api/interfaces/ResolvedWindow#implied)

***

### notes

> `readonly` **notes**: readonly [`TimeNote`](/docs/api/type-aliases/TimeNote)[]

Defined in: [src/core/time/resolve.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L140)

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`notes`](/docs/api/interfaces/ResolvedWindow#notes)

***

### parse

> `readonly` **parse**: `number`

Defined in: [src/core/time/resolve.ts:147](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L147)

Which of the mention's parses it came from.

***

### range

> `readonly` **range**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/core/time/resolve.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L129)

Always present: a look-back resolved against the clock. Spelled in the offset the person meant.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`range`](/docs/api/interfaces/ResolvedWindow#range)

***

### reader

> `readonly` **reader**: `object`

Defined in: [src/core/time/resolve.ts:139](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L139)

#### id

> `readonly` **id**: `string`

#### kind

> `readonly` **kind**: `"model"` \| `"rule"`

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`reader`](/docs/api/interfaces/ResolvedWindow#reader)

***

### reading

> `readonly` **reading**: [`ReadingTags`](/docs/api/interfaces/ReadingTags)

Defined in: [src/core/time/resolve.ts:145](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L145)

***

### said

> `readonly` **said**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolve.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L135)

The parts the person said — empty for a `model` reader's reading (§ 5.5).

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`said`](/docs/api/interfaces/ResolvedWindow#said)

***

### window

> `readonly` **window**: [`TimeWindow`](/docs/api/type-aliases/TimeWindow)

Defined in: [src/core/time/resolve.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L127)

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`window`](/docs/api/interfaces/ResolvedWindow#window)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/core/time/resolve.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L131)

The zone the person meant, else the clock's.

#### Inherited from

[`ResolvedWindow`](/docs/api/interfaces/ResolvedWindow).[`zone`](/docs/api/interfaces/ResolvedWindow#zone)
