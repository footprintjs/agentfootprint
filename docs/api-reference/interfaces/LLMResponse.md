[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMResponse

# Interface: LLMResponse

Defined in: [agentfootprint/src/adapters/types.ts:59](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L59)

## Properties

### content

> `readonly` **content**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:60](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L60)

***

### providerRef?

> `readonly` `optional` **providerRef?**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:73](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L73)

***

### stopReason

> `readonly` **stopReason**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:72](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L72)

***

### toolCalls

> `readonly` **toolCalls**: readonly `object`[]

Defined in: [agentfootprint/src/adapters/types.ts:61](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L61)

***

### usage

> `readonly` **usage**: `object`

Defined in: [agentfootprint/src/adapters/types.ts:66](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L66)

#### cacheRead?

> `readonly` `optional` **cacheRead?**: `number`

#### cacheWrite?

> `readonly` `optional` **cacheWrite?**: `number`

#### input

> `readonly` **input**: `number`

#### output

> `readonly` **output**: `number`
