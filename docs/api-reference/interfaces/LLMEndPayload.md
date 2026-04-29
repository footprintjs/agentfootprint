[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMEndPayload

# Interface: LLMEndPayload

Defined in: [agentfootprint/src/events/payloads.ts:127](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L127)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:129](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L129)

***

### durationMs

> `readonly` **durationMs**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:138](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L138)

***

### iteration

> `readonly` **iteration**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:128](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L128)

***

### providerResponseRef?

> `readonly` `optional` **providerResponseRef?**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:139](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L139)

***

### stopReason

> `readonly` **stopReason**: `string`

Defined in: [agentfootprint/src/events/payloads.ts:137](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L137)

***

### toolCallCount

> `readonly` **toolCallCount**: `number`

Defined in: [agentfootprint/src/events/payloads.ts:130](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L130)

***

### usage

> `readonly` **usage**: `object`

Defined in: [agentfootprint/src/events/payloads.ts:131](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/events/payloads.ts#L131)

#### cacheRead?

> `readonly` `optional` **cacheRead?**: `number`

#### cacheWrite?

> `readonly` `optional` **cacheWrite?**: `number`

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`
