[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SlidingWindowRecord

# Interface: SlidingWindowRecord

Defined in: [src/core/agent/window/types.ts:194](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L194)

What one visit to `slidingWindow` put in the ledger.

## Extends

- [`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md)

## Properties

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/core/agent/window/types.ts:143](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L143)

ReAct iteration this visit belongs to.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`iteration`](/agentfootprint/api/generated/interfaces/WindowRecord.md#iteration)

***

### keepRecentTurns

> `readonly` **keepRecentTurns**: `number`

Defined in: [src/core/agent/window/types.ts:197](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L197)

The configured keep depth this visit measured against.

***

### refusals

> `readonly` **refusals**: readonly [`WindowRefusal`](/agentfootprint/api/generated/interfaces/WindowRefusal.md)[]

Defined in: [src/core/agent/window/types.ts:152](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L152)

Every turn that refused to leave, named.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`refusals`](/agentfootprint/api/generated/interfaces/WindowRecord.md#refusals)

***

### removedMessageCount

> `readonly` **removedMessageCount**: `number`

Defined in: [src/core/agent/window/types.ts:147](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L147)

How many messages left the window.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedMessageCount`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedmessagecount)

***

### removedStageIds

> `readonly` **removedStageIds**: readonly `string`[]

Defined in: [src/core/agent/window/types.ts:145](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L145)

`runtimeStageId`s of the stages that appended the messages that left.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`removedStageIds`](/agentfootprint/api/generated/interfaces/WindowRecord.md#removedstageids)

***

### strategy

> `readonly` **strategy**: `"sliding-window"`

Defined in: [src/core/agent/window/types.ts:195](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L195)

`WindowStrategy.name` of the strategy that decided — `'summarize-oldest'`,
`'sliding-window'`, `'token-budget'`, or your own. Narrow on it.

#### Overrides

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`strategy`](/agentfootprint/api/generated/interfaces/WindowRecord.md#strategy)

***

### turnsAfter

> `readonly` **turnsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:200](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L200)

***

### turnsBefore

> `readonly` **turnsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:199](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L199)

Turns in the window before / after this visit. Counted, not estimated.

***

### windowCharsAfter

> `readonly` **windowCharsAfter**: `number`

Defined in: [src/core/agent/window/types.ts:150](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L150)

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsAfter`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsafter)

***

### windowCharsBefore

> `readonly` **windowCharsBefore**: `number`

Defined in: [src/core/agent/window/types.ts:149](https://github.com/footprintjs/agentfootprint/blob/be13dd062db4fa626d4af30277e77e87f7844ab6/src/core/agent/window/types.ts#L149)

Window size in chars before / after this visit. Exact, and not tokens.

#### Inherited from

[`WindowRecord`](/agentfootprint/api/generated/interfaces/WindowRecord.md).[`windowCharsBefore`](/agentfootprint/api/generated/interfaces/WindowRecord.md#windowcharsbefore)
