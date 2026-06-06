[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentfootprintEventEnvelope

# Interface: AgentfootprintEventEnvelope\<TType, TPayload\>

Defined in: [src/events/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/types.ts#L102)

Discriminated-union envelope every event implements.

## Type Parameters

### TType

`TType` *extends* `string`

### TPayload

`TPayload`

## Properties

### meta

> `readonly` **meta**: [`EventMeta`](/agentfootprint/api/generated/interfaces/EventMeta.md)

Defined in: [src/events/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/types.ts#L105)

***

### payload

> `readonly` **payload**: `TPayload`

Defined in: [src/events/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/types.ts#L104)

***

### type

> `readonly` **type**: `TType`

Defined in: [src/events/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/7ab699b43b69875e30b9726bca6c365aee3b107c/src/events/types.ts#L103)
