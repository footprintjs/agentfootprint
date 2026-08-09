[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / LlmSwarmOptions

# Interface: LlmSwarmOptions

Defined in: [src/patterns/LlmSwarm.ts:68](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmSwarm.ts#L68)

## Properties

### agents

> `readonly` **agents**: readonly [`LlmSwarmAgent`](/agentfootprint/api/generated/interfaces/LlmSwarmAgent.md)[]

Defined in: [src/patterns/LlmSwarm.ts:74](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmSwarm.ts#L74)

The roster. Two or more; ids must be unique and none may be `'done'`.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [src/patterns/LlmSwarm.ts:85](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmSwarm.ts#L85)

Stable id for the swarm's composition events. Default `'swarm'`.

***

### instruction?

> `readonly` `optional` **instruction?**: `string`

Defined in: [src/patterns/LlmSwarm.ts:76](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmSwarm.ts#L76)

Extra authored framing for the router. See `llmRouter`.

***

### maxHandoffs?

> `readonly` `optional` **maxHandoffs?**: `number`

Defined in: [src/patterns/LlmSwarm.ts:83](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmSwarm.ts#L83)

Maximum agent turns before the loop halts. Default 10 (the swarm's
own default). The router runs once per turn plus once to start.

***

### model

> `readonly` **model**: `string`

Defined in: [src/patterns/LlmSwarm.ts:72](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmSwarm.ts#L72)

Model to ask for routing decisions.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/patterns/LlmSwarm.ts:87](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmSwarm.ts#L87)

Display name. Default `'Swarm'`.

***

### provider

> `readonly` **provider**: [`LLMProvider`](/agentfootprint/api/generated/interfaces/LLMProvider.md)

Defined in: [src/patterns/LlmSwarm.ts:70](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmSwarm.ts#L70)

The LLM that makes the routing decisions (not the specialists' own).

***

### temperature?

> `readonly` `optional` **temperature?**: `number`

Defined in: [src/patterns/LlmSwarm.ts:78](https://github.com/footprintjs/agentfootprint/blob/da4d9975cc6a2f88b2692e1773dc59434515cc7a/src/patterns/LlmSwarm.ts#L78)

Routing temperature. Default `0`.
