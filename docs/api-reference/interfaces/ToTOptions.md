[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / ToTOptions

# Interface: ToTOptions

Defined in: [agentfootprint/src/patterns/ToT.ts:26](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L26)

## Properties

### beamWidth?

> `readonly` `optional` **beamWidth?**: `number`

Defined in: [agentfootprint/src/patterns/ToT.ts:42](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L42)

Beam width — how many thoughts survive after each level. Default 1 (greedy).

***

### branchingFactor

> `readonly` **branchingFactor**: `number`

Defined in: [agentfootprint/src/patterns/ToT.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L34)

Branching factor — K thoughts generated per frontier node per iteration.

***

### depth

> `readonly` **depth**: `number`

Defined in: [agentfootprint/src/patterns/ToT.ts:32](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L32)

Depth of the tree (number of expansion iterations).

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [agentfootprint/src/patterns/ToT.ts:46](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L46)

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [agentfootprint/src/patterns/ToT.ts:44](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L44)

***

### model

> `readonly` **model**: `string`

Defined in: [agentfootprint/src/patterns/ToT.ts:28](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L28)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [agentfootprint/src/patterns/ToT.ts:45](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L45)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [agentfootprint/src/patterns/ToT.ts:27](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L27)

***

### score

> `readonly` **score**: (`thought`) => `number`

Defined in: [agentfootprint/src/patterns/ToT.ts:40](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L40)

Scorer: given a thought, return a numeric score. Higher is better.
The top `beamWidth` thoughts survive each level; the rest are pruned.
Synchronous so pruning is deterministic.

#### Parameters

##### thought

`string`

#### Returns

`number`

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [agentfootprint/src/patterns/ToT.ts:43](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L43)

***

### thoughtPrompt

> `readonly` **thoughtPrompt**: `string`

Defined in: [agentfootprint/src/patterns/ToT.ts:30](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/ToT.ts#L30)

System prompt for the thought-generation LLMCall.
