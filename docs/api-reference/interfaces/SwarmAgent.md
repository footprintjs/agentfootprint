[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SwarmAgent

# Interface: SwarmAgent

Defined in: [src/patterns/Swarm.ts:26](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/patterns/Swarm.ts#L26)

## Extended by

- [`LlmSwarmAgent`](/agentfootprint/api/generated/interfaces/LlmSwarmAgent.md)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [src/patterns/Swarm.ts:28](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/patterns/Swarm.ts#L28)

Stable id used in events + routing decisions.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/patterns/Swarm.ts:30](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/patterns/Swarm.ts#L30)

Display name for topology / narrative.

***

### runner

> `readonly` **runner**: [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/Swarm.ts:32](https://github.com/footprintjs/agentfootprint/blob/6d36ae240cf24d0dcc1b65e0f65dca700a4a788d/src/patterns/Swarm.ts#L32)

The runner that handles a turn when selected.
