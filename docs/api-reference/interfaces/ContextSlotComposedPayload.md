[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ContextSlotComposedPayload

# Interface: ContextSlotComposedPayload

Defined in: [agentfootprint/src/events/payloads.ts:191](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L191)

## Properties

### budget

> `readonly` **budget**: `object`

Defined in: [agentfootprint/src/events/payloads.ts:194](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L194)

#### cap

> `readonly` **cap**: `number`

#### headroomChars

> `readonly` **headroomChars**: `number`

#### used

> `readonly` **used**: `number`

***

### droppedCount

> `readonly` **droppedCount**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:203](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L203)

***

### droppedSummaries

> `readonly` **droppedSummaries**: readonly `string`[]

Defined in: [agentfootprint/src/events/payloads.ts:204](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L204)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:193](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L193)

***

### orderingStrategy?

> `readonly` `optional` **orderingStrategy?**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:202](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L202)

***

### slot

> `readonly` **slot**: [`ContextSlot`](/agentfootprint/api/generated/type-aliases/ContextSlot.md)

Defined in: [agentfootprint/src/events/payloads.ts:192](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L192)

***

### sourceBreakdown

> `readonly` **sourceBreakdown**: `Readonly`\<`Partial`\<`Record`\<[`ContextSource`](/agentfootprint/api/generated/type-aliases/ContextSource.md), \{ `chars`: `number`; `count`: `number`; \}\>\>\>

Defined in: [agentfootprint/src/events/payloads.ts:199](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L199)
