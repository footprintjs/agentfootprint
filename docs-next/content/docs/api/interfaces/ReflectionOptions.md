---
title: ReflectionOptions
---

# Interface: ReflectionOptions

Defined in: src/patterns/Reflection.ts:20

## Properties

### criticPrompt

> `readonly` **criticPrompt**: `string`

Defined in: src/patterns/Reflection.ts:31

System prompt for the critic. Should instruct the critic to return
"DONE" (or a consumer-chosen sentinel) when the proposal is good
enough — that string is checked by `untilCritiqueContains` to stop
the refinement loop.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: src/patterns/Reflection.ts:43

***

### maxIterations?

> `readonly` `optional` **maxIterations?**: `number`

Defined in: src/patterns/Reflection.ts:39

Max refinement iterations. Default 3.

***

### maxTokens?

> `readonly` `optional` **maxTokens?**: `number`

Defined in: src/patterns/Reflection.ts:41

***

### model

> `readonly` **model**: `string`

Defined in: src/patterns/Reflection.ts:22

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: src/patterns/Reflection.ts:42

***

### proposerPrompt

> `readonly` **proposerPrompt**: `string`

Defined in: src/patterns/Reflection.ts:24

System prompt for the initial / revision proposer.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: src/patterns/Reflection.ts:21

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: src/patterns/Reflection.ts:40

***

### untilCritiqueContains?

> `readonly` `optional` **untilCritiqueContains?**: `string`

Defined in: src/patterns/Reflection.ts:37

Stop string the critic should emit when satisfied. When the critic's
response contains this substring, the loop exits and the last
proposal is returned. Default: 'DONE'.
