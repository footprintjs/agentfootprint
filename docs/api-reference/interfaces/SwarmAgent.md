[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SwarmAgent

# Interface: SwarmAgent

Defined in: [agentfootprint/src/patterns/Swarm.ts:26](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L26)

## Properties

### id

> `readonly` **id**: `string`

Defined in: [agentfootprint/src/patterns/Swarm.ts:28](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L28)

Stable id used in events + routing decisions.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [agentfootprint/src/patterns/Swarm.ts:30](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L30)

Display name for topology / narrative.

***

### runner

> `readonly` **runner**: [`Runner`](/agentfootprint/api/generated/interfaces/Runner.md)\<\{ `message`: `string`; \}, `string`\>

Defined in: [agentfootprint/src/patterns/Swarm.ts:32](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L32)

The runner that handles a turn when selected.
