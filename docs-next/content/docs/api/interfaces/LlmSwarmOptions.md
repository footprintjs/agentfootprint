---
title: LlmSwarmOptions
---

# Interface: LlmSwarmOptions

Defined in: [src/patterns/LlmSwarm.ts:24](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L24)

## Properties

### agents

> `readonly` **agents**: readonly [`LlmSwarmAgent`](/docs/api/interfaces/LlmSwarmAgent)[]

Defined in: [src/patterns/LlmSwarm.ts:30](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L30)

The roster. Two or more; ids must be unique and none may be `'done'`.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/patterns/LlmSwarm.ts:41](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L41)

Stable id for the swarm's composition events. Default `'swarm'`.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/patterns/LlmSwarm.ts:32](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L32)

Extra authored framing for the router. See `llmRouter`.

***

### maxHandoffs?

> `readonly` `optional` **maxHandoffs?**: `number`

Defined in: [src/patterns/LlmSwarm.ts:39](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L39)

Maximum agent turns before the loop halts. Default 10 (the swarm's
own default). The router runs once per dispatch; no extra call follows the budget.

***

### model

> `readonly` **model**: `string`

Defined in: [src/patterns/LlmSwarm.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L28)

Model to ask for routing decisions.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/patterns/LlmSwarm.ts:43](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L43)

Display name. Default `'Swarm'`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/docs/api/interfaces/LLMProvider)

Defined in: [src/patterns/LlmSwarm.ts:26](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L26)

The LLM that makes the routing decisions (not the specialists' own).

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/patterns/LlmSwarm.ts:34](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L34)

Routing temperature. Default `0`.
