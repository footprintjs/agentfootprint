[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / MapReduceOptions

# Interface: MapReduceOptions

Defined in: [agentfootprint/src/patterns/MapReduce.ts:32](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L32)

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [agentfootprint/src/patterns/MapReduce.ts:58](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L58)

***

### mapPrompt

> `readonly` **mapPrompt**: `string`

Defined in: [agentfootprint/src/patterns/MapReduce.ts:36](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L36)

System prompt applied to every shard's LLMCall.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [agentfootprint/src/patterns/MapReduce.ts:56](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L56)

***

### model

> `readonly` **model**: `string`

Defined in: [agentfootprint/src/patterns/MapReduce.ts:34](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L34)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [agentfootprint/src/patterns/MapReduce.ts:57](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L57)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [agentfootprint/src/patterns/MapReduce.ts:33](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L33)

***

### reduce

> `readonly` **reduce**: \{ `fn`: [`MergeFn`](/agentfootprint/api/generated/type-aliases/MergeFn.md); `kind`: `"fn"`; \} \| \{ `kind`: `"llm"`; `opts`: [`MergeWithLLMOptions`](/agentfootprint/api/generated/interfaces/MergeWithLLMOptions.md); \}

Defined in: [agentfootprint/src/patterns/MapReduce.ts:52](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L52)

Reducer — either a pure fn combining the N shard outputs, OR an LLM
synthesizer.

***

### shardCount

> `readonly` **shardCount**: `number`

Defined in: [agentfootprint/src/patterns/MapReduce.ts:41](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L41)

Number of shards to fan out. Must be >= 2 (for one-shard, use
`LLMCall` directly). Fixed at build time.

***

### split

> `readonly` **split**: (`input`, `shardCount`) => readonly `string`[]

Defined in: [agentfootprint/src/patterns/MapReduce.ts:47](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L47)

Splitter invoked at run time with `(input, shardCount)`. MUST return
exactly `shardCount` strings. If it returns fewer, remaining shards
receive empty strings; more are truncated.

#### Parameters

##### input

`string`

##### shardCount

`number`

#### Returns

readonly `string`[]

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [agentfootprint/src/patterns/MapReduce.ts:55](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/MapReduce.ts#L55)
