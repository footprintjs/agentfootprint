---
title: MapReduceOptions
---

# Interface: MapReduceOptions

Defined in: src/patterns/MapReduce.ts:32

## Properties

### id?

> `readonly` `optional` **id?**: `string`

Defined in: src/patterns/MapReduce.ts:58

***

### mapPrompt

> `readonly` **mapPrompt**: `string`

Defined in: src/patterns/MapReduce.ts:36

System prompt applied to every shard's LLMCall.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: src/patterns/MapReduce.ts:56

***

### model

> `readonly` **model**: `string`

Defined in: src/patterns/MapReduce.ts:34

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: src/patterns/MapReduce.ts:57

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: src/patterns/MapReduce.ts:33

***

### reduce

> `readonly` **reduce**: \{ `fn`: [`MergeFn`](/docs/api/type-aliases/MergeFn); `kind`: `"fn"`; \} \| \{ `kind`: `"llm"`; `opts`: [`MergeWithLLMOptions`](/docs/api/interfaces/MergeWithLLMOptions); \}

Defined in: src/patterns/MapReduce.ts:52

Reducer — either a pure fn combining the N shard outputs, OR an LLM
synthesizer.

***

### shardCount

> `readonly` **shardCount**: `number`

Defined in: src/patterns/MapReduce.ts:41

Number of shards to fan out. Must be >= 2 (for one-shard, use
`LLMCall` directly). Fixed at build time.

***

### split

> `readonly` **split**: (`input`, `shardCount`) => readonly `string`[]

Defined in: src/patterns/MapReduce.ts:47

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

Defined in: src/patterns/MapReduce.ts:55
