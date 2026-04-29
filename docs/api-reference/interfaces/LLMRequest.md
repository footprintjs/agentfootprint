[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LLMRequest

# Interface: LLMRequest

Defined in: [agentfootprint/src/adapters/types.ts:48](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L48)

## Properties

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [agentfootprint/src/adapters/types.ts:54](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L54)

***

### messages

> `readonly` **messages**: readonly [`LLMMessage`](/agentfootprint/api/generated/interfaces/LLMMessage.md)[]

Defined in: [agentfootprint/src/adapters/types.ts:50](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L50)

***

### model

> `readonly` **model**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:52](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L52)

***

### signal?

> `readonly` `optional` **signal?**: `AbortSignal`

Defined in: [agentfootprint/src/adapters/types.ts:56](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L56)

***

### stop?

> `readonly` `optional` **stop?**: readonly `string`[]

Defined in: [agentfootprint/src/adapters/types.ts:55](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L55)

***

### systemPrompt?

> `readonly` `optional` **systemPrompt?**: `string`

Defined in: [agentfootprint/src/adapters/types.ts:49](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L49)

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [agentfootprint/src/adapters/types.ts:53](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L53)

***

### tools?

> `readonly` `optional` **tools?**: readonly [`LLMToolSchema`](/agentfootprint/api/generated/interfaces/LLMToolSchema.md)[]

Defined in: [agentfootprint/src/adapters/types.ts:51](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/adapters/types.ts#L51)
