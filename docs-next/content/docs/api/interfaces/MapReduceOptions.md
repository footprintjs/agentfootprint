---
title: MapReduceOptions
---

# Interface: MapReduceOptions

Defined in: [src/patterns/MapReduce.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L34)

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/patterns/MapReduce.ts:60](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L60)

***

### mapPrompt

> `readonly` **mapPrompt**: `string`

Defined in: [src/patterns/MapReduce.ts:38](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L38)

System prompt applied to every shard's LLMCall.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: [src/patterns/MapReduce.ts:58](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L58)

***

### model

> `readonly` **model**: `string`

Defined in: [src/patterns/MapReduce.ts:36](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L36)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/patterns/MapReduce.ts:59](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L59)

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/patterns/MapReduce.ts:35](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L35)

***

### reduce

> `readonly` **reduce**: \{ `fn`: [`MergeFn`](/docs/api/type-aliases/MergeFn); `kind`: `"fn"`; \} \| \{ `kind`: `"llm"`; `opts`: [`MergeWithLLMOptions`](/docs/api/interfaces/MergeWithLLMOptions); \}

Defined in: [src/patterns/MapReduce.ts:54](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L54)

Reducer — either a pure fn combining the N shard outputs, OR an LLM
synthesizer.

***

### shardCount

> `readonly` **shardCount**: `number`

Defined in: [src/patterns/MapReduce.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L43)

Number of shards to fan out. Must be >= 2 (for one-shard, use
`LLMCall` directly). Fixed at build time.

***

### split

> `readonly` **split**: (`input`, `shardCount`) => readonly `string`[]

Defined in: [src/patterns/MapReduce.ts:49](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L49)

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

Defined in: [src/patterns/MapReduce.ts:57](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/MapReduce.ts#L57)
