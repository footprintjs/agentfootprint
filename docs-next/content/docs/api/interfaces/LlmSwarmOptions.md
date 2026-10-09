---
title: LlmSwarmOptions
---

# Interface: LlmSwarmOptions

Defined in: src/patterns/LlmSwarm.ts:68

## Properties

### agents

> `readonly` **agents**: readonly [`LlmSwarmAgent`](/docs/api/interfaces/LlmSwarmAgent)[]

Defined in: src/patterns/LlmSwarm.ts:74

The roster. Two or more; ids must be unique and none may be `'done'`.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: src/patterns/LlmSwarm.ts:85

Stable id for the swarm's composition events. Default `'swarm'`.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: src/patterns/LlmSwarm.ts:76

Extra authored framing for the router. See `llmRouter`.

***

### maxHandoffs?

> `readonly` `optional` **maxHandoffs?**: `number`

Defined in: src/patterns/LlmSwarm.ts:83

Maximum agent turns before the loop halts. Default 10 (the swarm's
own default). The router runs once per turn plus once to start.

***

### model

> `readonly` **model**: `string`

Defined in: src/patterns/LlmSwarm.ts:72

Model to ask for routing decisions.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: src/patterns/LlmSwarm.ts:87

Display name. Default `'Swarm'`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: src/patterns/LlmSwarm.ts:70

The LLM that makes the routing decisions (not the specialists' own).

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: src/patterns/LlmSwarm.ts:78

Routing temperature. Default `0`.
