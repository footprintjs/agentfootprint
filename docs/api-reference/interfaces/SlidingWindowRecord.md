[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SlidingWindowRecord

# Interface: SlidingWindowRecord

Defined in: [src/core/agent/window/types.ts:162](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L162)

What one visit to `slidingWindow` put in the ledger.

## Extends

- [`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md)

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:121](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L121)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`iteration`](/agentfootprint/api/generated/interfaces/WindowRecord.md#iteration)

***

### keepRecentTurns

> `readonly` **keepRecentTurns**: `number`

Defined in: [src/core/agent/window/types.ts:165](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L165)

The configured keep depth this visit measured against.

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/types.ts:130](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L130)

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`refusals`](/agentfootprint/api/generated/interfaces/WindowRecord.md#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:125](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L125)

How many messages left the window.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedMessageCount`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:123](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L123)

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedStageIds`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedstageids)

***

### strategy

> `readonly` **strategy**: `"sliding-window"`

Defined in: [src/core/agent/window/types.ts:163](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L163)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Overrides

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`strategy`](/agentfootprint/api/generated/interfaces/WindowRecord.md#strategy)

***

### turnsAfter

> `readonly` **turnsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:168](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L168)

***

### turnsBefore

> `readonly` **turnsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:167](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L167)

Turns in the window before / after this visit. Counted, not estimated.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:128](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L128)

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsAfter`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:127](https://github.com/footprintjs/agentfootprint/blob/46a226862ee67a629d071a39169d46fb5aa79ccf/src/core/agent/window/types.ts#L127)

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsBefore`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsbefore)
