---
title: ToTOptions
---

# Interface: ToTOptions

Defined in: src/patterns/ToT.ts:26

## Properties

### beamWidth?

> `readonly` `optional` **beamWidth?**: `number`

Defined in: src/patterns/ToT.ts:42

Beam width — how many thoughts survive after each level. Default 1 (greedy).

***

### branchingFactor

> `readonly` **branchingFactor**: `number`

Defined in: src/patterns/ToT.ts:34

Branching factor — K thoughts generated per frontier node per iteration.

***

### depth

> `readonly` **depth**: `number`

Defined in: src/patterns/ToT.ts:32

Depth of the tree (number of expansion iterations).

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: src/patterns/ToT.ts:46

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: src/patterns/ToT.ts:44

***

### model

> `readonly` **model**: `string`

Defined in: src/patterns/ToT.ts:28

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: src/patterns/ToT.ts:45

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: src/patterns/ToT.ts:27

***

### score

> `readonly` **score**: (`thought`) => `number`

Defined in: src/patterns/ToT.ts:40

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

Defined in: src/patterns/ToT.ts:43

***

### thoughtPrompt

> `readonly` **thoughtPrompt**: `string`

Defined in: src/patterns/ToT.ts:30

System prompt for the thought-generation LLMCall.
