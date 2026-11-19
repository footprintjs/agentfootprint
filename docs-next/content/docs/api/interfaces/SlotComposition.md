---
title: SlotComposition
---

# Interface: SlotComposition

Defined in: [src/recorders/core/types.ts:66](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L66)

Slot composition summary — written by a slot subflow at the END of its
composition pass. ContextRecorder emits one `context.slot_composed`
event per slot exit, built from this record.

## Properties

### budget

> `readonly` **budget**: `object`

Defined in: [src/recorders/core/types.ts:69](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L69)

#### cap

> `readonly` **cap**: `number`

#### headroomChars

> `readonly` **headroomChars**: `number`

#### used

> `readonly` **used**: `number`

***

### droppedCount

> `readonly` **droppedCount**: `number`

Defined in: [src/recorders/core/types.ts:78](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L78)

***

### droppedSummaries

> `readonly` **droppedSummaries**: readonly `string`[]

Defined in: [src/recorders/core/types.ts:79](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L79)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/recorders/core/types.ts:68](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L68)

***

### orderingStrategy?

> `readonly` `optional` **orderingStrategy?**: `string`

Defined in: [src/recorders/core/types.ts:77](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L77)

***

### slot

> `readonly` **slot**: `ContextSlot`

Defined in: [src/recorders/core/types.ts:67](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L67)

***

### sourceBreakdown

> `readonly` **sourceBreakdown**: `Readonly`\<`Partial`\<`Record`\<`ContextSource`, \{ `chars`: `number`; `count`: `number`; \}\>\>\>

Defined in: [src/recorders/core/types.ts:74](https://github.com/footprintjs/agentfootprint/blob/main/src/recorders/core/types.ts#L74)
