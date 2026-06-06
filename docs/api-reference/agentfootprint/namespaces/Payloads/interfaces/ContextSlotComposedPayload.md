[**agentfootprint**](../../../../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / [Payloads](/agentfootprint/api/generated/agentfootprint/namespaces/Payloads/README.md) / ContextSlotComposedPayload

# Interface: ContextSlotComposedPayload

Defined in: [src/events/payloads.ts:220](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L220)

## Properties

### budget

> `readonly` **budget**: `object`

Defined in: [src/events/payloads.ts:223](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L223)

#### cap

> `readonly` **cap**: `number`

#### headroomChars

> `readonly` **headroomChars**: `number`

#### used

> `readonly` **used**: `number`

***

### droppedCount

> `readonly` **droppedCount**: `number`

Defined in: [src/events/payloads.ts:232](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L232)

***

### droppedSummaries

> `readonly` **droppedSummaries**: readonly `string`[]

Defined in: [src/events/payloads.ts:233](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L233)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [src/events/payloads.ts:222](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L222)

***

### orderingStrategy?

> `readonly` `optional` **orderingStrategy?**: `string`

Defined in: [src/events/payloads.ts:231](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L231)

***

### slot

> `readonly` **slot**: [`ContextSlot`](/agentfootprint/api/generated/type-aliases/ContextSlot.md)

Defined in: [src/events/payloads.ts:221](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L221)

***

### sourceBreakdown

> `readonly` **sourceBreakdown**: `Readonly`\<`Partial`\<`Record`\<[`ContextSource`](/agentfootprint/api/generated/type-aliases/ContextSource.md), \{ `chars`: `number`; `count`: `number`; \}\>\>\>

Defined in: [src/events/payloads.ts:228](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/payloads.ts#L228)
