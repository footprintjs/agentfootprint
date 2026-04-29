[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / AgentfootprintEventEnvelope

# Interface: AgentfootprintEventEnvelope\<TType, TPayload\>

Defined in: [agentfootprint/src/events/types.ts:102](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L102)

Discriminated-union envelope every event implements.

## Type Parameters

### TType

`TType` *extends* `string`

### TPayload

`TPayload`

## Properties

### meta

> `readonly` **meta**: [`EventMeta`](/agentfootprint/api/generated/interfaces/EventMeta.md)

Defined in: [agentfootprint/src/events/types.ts:105](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L105)

***

### payload

> `readonly` **payload**: `TPayload`

Defined in: [agentfootprint/src/events/types.ts:104](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L104)

***

### type

> `readonly` **type**: `TType`

Defined in: [agentfootprint/src/events/types.ts:103](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/types.ts#L103)
