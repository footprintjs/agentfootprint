---
title: SlotComposition
---

# Interface: SlotComposition

Defined in: [src/recorders/core/types.ts:73](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L73)

Slot composition summary — written by a slot subflow at the END of its
composition pass. ContextRecorder emits one `context.slot_composed`
event per slot exit, built from this record.

## Properties

### budget

> `readonly` **budget**: `object`

Defined in: [src/recorders/core/types.ts:76](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L76)

#### cap

> `readonly` **cap**: `number`

#### headroomChars

> `readonly` **headroomChars**: `number`

#### used

> `readonly` **used**: `number`

***

### droppedCount

> `readonly` **droppedCount**: `number`

Defined in: [src/recorders/core/types.ts:85](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L85)

***

### droppedSummaries

> `readonly` **droppedSummaries**: readonly `string`[]

Defined in: [src/recorders/core/types.ts:86](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L86)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/recorders/core/types.ts:75](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L75)

***

### orderingStrategy?

> `readonly` `optional` **orderingStrategy?**: `string`

Defined in: [src/recorders/core/types.ts:84](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L84)

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: [src/recorders/core/types.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L74)

***

### sourceBreakdown

> `readonly` **sourceBreakdown**: `Readonly`\<`Partial`\<`Record`\<`ContextSource`, \{ `chars`: `number`; `count`: `number`; \}\>\>\>

Defined in: [src/recorders/core/types.ts:81](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L81)
