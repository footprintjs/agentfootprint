---
title: ContextSlotComposedPayload
---

# Interface: ContextSlotComposedPayload

Defined in: [src/events/payloads.ts:229](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L229)

## Properties

### budget

> `readonly` **budget**: `object`

Defined in: [src/events/payloads.ts:232](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L232)

#### cap

> `readonly` **cap**: `number`

#### headroomChars

> `readonly` **headroomChars**: `number`

#### used

> `readonly` **used**: `number`

***

### droppedCount

> `readonly` **droppedCount**: `number`

Defined in: [src/events/payloads.ts:241](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L241)

***

### droppedSummaries

> `readonly` **droppedSummaries**: readonly `string`[]

Defined in: [src/events/payloads.ts:242](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L242)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:231](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L231)

***

### orderingStrategy?

> `readonly` `optional` **orderingStrategy?**: `string`

Defined in: [src/events/payloads.ts:240](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L240)

***

### slot

> `readonly` **slot**: [`ContextSlot`](/docs/api/type-aliases/ContextSlot)

Defined in: [src/events/payloads.ts:230](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L230)

***

### sourceBreakdown

> `readonly` **sourceBreakdown**: `Readonly`\<`Partial`\<`Record`\<[`ContextSource`](/docs/api/type-aliases/ContextSource), \{ `chars`: `number`; `count`: `number`; \}\>\>\>

Defined in: [src/events/payloads.ts:237](https://github.com/footprintjs/agentfootprint/blob/main/src/events/payloads.ts#L237)
