[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentfootprintEventEnvelope

# Interface: AgentfootprintEventEnvelope\<TType, TPayload\>

Defined in: [src/events/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/types.ts#L102)

Discriminated-union envelope every event implements.

## Type Parameters

### TType

`TType` *extends* `string`

### TPayload

`TPayload`

## Properties

### meta

> `readonly` **meta**: [`EventMeta`](/agentfootprint/api/generated/interfaces/EventMeta.md)

Defined in: [src/events/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/types.ts#L105)

***

### payload

> `readonly` **payload**: `TPayload`

Defined in: [src/events/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/types.ts#L104)

***

### type

> `readonly` **type**: `TType`

Defined in: [src/events/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/ce5c708227cccb85e3e861d928c5c8ca4dbc2054/src/events/types.ts#L103)
