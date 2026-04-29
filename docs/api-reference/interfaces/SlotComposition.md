[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SlotComposition

# Interface: SlotComposition

Defined in: [agentfootprint/src/recorders/core/types.ts:63](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L63)

Slot composition summary — written by a slot subflow at the END of its
composition pass. ContextRecorder emits one `context.slot_composed`
event per slot exit, built from this record.

## Properties

### budget

> `readonly` **budget**: `object`

Defined in: [agentfootprint/src/recorders/core/types.ts:66](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L66)

#### cap

> `readonly` **cap**: `number`

#### headroomChars

> `readonly` **headroomChars**: `number`

#### used

> `readonly` **used**: `number`

***

### droppedCount

> `readonly` **droppedCount**: `number`

Defined in: [agentfootprint/src/recorders/core/types.ts:75](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L75)

***

### droppedSummaries

> `readonly` **droppedSummaries**: readonly `string`[]

Defined in: [agentfootprint/src/recorders/core/types.ts:76](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L76)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [agentfootprint/src/recorders/core/types.ts:65](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L65)

***

### orderingStrategy?

> `readonly` `optional` **orderingStrategy?**: `string`

Defined in: [agentfootprint/src/recorders/core/types.ts:74](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L74)

***

### slot

> `readonly` **slot**: [`ContextSlot`](/agentfootprint/api/generated/type-aliases/ContextSlot.md)

Defined in: [agentfootprint/src/recorders/core/types.ts:64](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L64)

***

### sourceBreakdown

> `readonly` **sourceBreakdown**: `Readonly`\<`Partial`\<`Record`\<[`ContextSource`](/agentfootprint/api/generated/type-aliases/ContextSource.md), \{ `chars`: `number`; `count`: `number`; \}\>\>\>

Defined in: [agentfootprint/src/recorders/core/types.ts:71](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/recorders/core/types.ts#L71)
