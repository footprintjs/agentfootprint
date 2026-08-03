---
title: SlidingWindowRecord
---

# Interface: SlidingWindowRecord

Defined in: [src/core/agent/window/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L165)

What one visit to `slidingWindow` put in the ledger.

## Extends

- [`WindowRecord`](/docs/api/interfaces/WindowRecord)

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L125)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`iteration`](/docs/api/interfaces/WindowRecord#iteration)

***

### keepRecentTurns

> `readonly` **keepRecentTurns**: `number`

Defined in: [src/core/agent/window/types.ts:168](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L168)

The configured keep depth this visit measured against.

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/docs/api/interfaces/WindowRefusal)[]

Defined in: [src/core/agent/window/types.ts:134](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L134)

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`refusals`](/docs/api/interfaces/WindowRecord#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:129](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L129)

How many messages left the window.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`removedMessageCount`](/docs/api/interfaces/WindowRecord#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:127](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L127)

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`removedStageIds`](/docs/api/interfaces/WindowRecord#removedstageids)

***

### strategy

> `readonly` **strategy**: `"sliding-window"`

Defined in: [src/core/agent/window/types.ts:166](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L166)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Overrides

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`strategy`](/docs/api/interfaces/WindowRecord#strategy)

***

### turnsAfter

> `readonly` **turnsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:171](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L171)

***

### turnsBefore

> `readonly` **turnsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:170](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L170)

Turns in the window before / after this visit. Counted, not estimated.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:132](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L132)

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`windowCharsAfter`](/docs/api/interfaces/WindowRecord#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:131](https://github.com/footprintjs/agentfootprint/blob/main/src/core/agent/window/types.ts#L131)

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/docs/api/interfaces/WindowRecord).[`windowCharsBefore`](/docs/api/interfaces/WindowRecord#windowcharsbefore)
