---
title: ResolvedWindow
---

# Interface: ResolvedWindow

Defined in: src/core/time/resolveRecord.ts:100

A window read from words, resolved against the clock (§ 3.2).

## Extended by

- [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)

## Properties

### anchor

> `readonly` **anchor**: `"none"` \| `"message"` \| `"previous-window"`

Defined in: src/core/time/resolveRecord.ts:112

***

### grain

> `readonly` **grain**: `Grain`

Defined in: src/core/time/resolveRecord.ts:107

The finest part the person said.

***

### implied

> `readonly` **implied**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: src/core/time/resolveRecord.ts:111

The parts this module filled: from the clock, the policy's candidates, the century.

***

### notes

> `readonly` **notes**: readonly [`TimeNote`](/docs/api/type-aliases/TimeNote)[]

Defined in: src/core/time/resolveRecord.ts:114

***

### range

> `readonly` **range**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: src/core/time/resolveRecord.ts:103

Always present: a look-back resolved against the clock. Spelled in the offset the person meant.

***

### reader

> `readonly` **reader**: `object`

Defined in: src/core/time/resolveRecord.ts:113

#### id

> `readonly` **id**: `string`

#### kind

> `readonly` **kind**: `"model"` \| `"rule"`

***

### said

> `readonly` **said**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: src/core/time/resolveRecord.ts:109

The parts the person said — empty for a `model` reader's reading (§ 5.5).

***

### window

> `readonly` **window**: [`TimeWindow`](/docs/api/type-aliases/TimeWindow)

Defined in: src/core/time/resolveRecord.ts:101

***

### zone

> `readonly` **zone**: `string`

Defined in: src/core/time/resolveRecord.ts:105

The zone the person meant, else the clock's.
