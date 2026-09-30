---
title: ResolvedWindow
---

# Interface: ResolvedWindow

Defined in: [src/core/time/resolve.ts:126](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L126)

A window read from words, resolved against the clock (§ 3.2).

## Extended by

- [`TimeCandidate`](/docs/api/interfaces/TimeCandidate)

## Properties

### anchor

> `readonly` **anchor**: `"none"` \| `"message"` \| `"previous-window"`

Defined in: [src/core/time/resolve.ts:138](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L138)

***

### grain

> `readonly` **grain**: `Grain`

Defined in: [src/core/time/resolve.ts:133](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L133)

The finest part the person said.

***

### implied

> `readonly` **implied**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolve.ts:137](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L137)

The parts this module filled: from the clock, the policy's candidates, the century.

***

### notes

> `readonly` **notes**: readonly [`TimeNote`](/docs/api/type-aliases/TimeNote)[]

Defined in: [src/core/time/resolve.ts:140](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L140)

***

### range

> `readonly` **range**: [`TimeRange`](/docs/api/interfaces/TimeRange)

Defined in: [src/core/time/resolve.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L129)

Always present: a look-back resolved against the clock. Spelled in the offset the person meant.

***

### reader

> `readonly` **reader**: `object`

Defined in: [src/core/time/resolve.ts:139](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L139)

#### id

> `readonly` **id**: `string`

#### kind

> `readonly` **kind**: `"model"` \| `"rule"`

***

### said

> `readonly` **said**: readonly [`TimePart`](/docs/api/type-aliases/TimePart)[]

Defined in: [src/core/time/resolve.ts:135](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L135)

The parts the person said — empty for a `model` reader's reading (§ 5.5).

***

### window

> `readonly` **window**: [`TimeWindow`](/docs/api/type-aliases/TimeWindow)

Defined in: [src/core/time/resolve.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L127)

***

### zone

> `readonly` **zone**: `string`

Defined in: [src/core/time/resolve.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/time/resolve.ts#L131)

The zone the person meant, else the clock's.
