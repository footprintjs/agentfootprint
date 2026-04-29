[**agentfootprint**](../README.md)

***

[agentfootprint](/agentfootprint/api/generated/README.md) / SwarmOptions

# Interface: SwarmOptions

Defined in: [agentfootprint/src/patterns/Swarm.ts:35](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L35)

## Properties

### agents

> `readonly` **agents**: readonly [`SwarmAgent`](/agentfootprint/api/generated/interfaces/SwarmAgent.md)[]

Defined in: [agentfootprint/src/patterns/Swarm.ts:40](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L40)

The fixed agent roster. Must contain >= 2 agents. The order doesn't
matter — the `route` function selects by id.

***

### id?

> `readonly` `optional` **id?**: `string`

Defined in: [agentfootprint/src/patterns/Swarm.ts:51](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L51)

***

### maxHandoffs?

> `readonly` `optional` **maxHandoffs?**: `number`

Defined in: [agentfootprint/src/patterns/Swarm.ts:49](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L49)

Max hand-offs before the loop halts. Default 10.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [agentfootprint/src/patterns/Swarm.ts:50](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L50)

***

### route

> `readonly` **route**: (`input`) => `string` \| `undefined`

Defined in: [agentfootprint/src/patterns/Swarm.ts:47](https://github.com/footprintjs/agentfootprint/blob/d43620baff0d65a1a2782f99f5d52ab3d232af78/src/patterns/Swarm.ts#L47)

Routing function — receives the current message and returns the
selected agent's id. Pure sync; evaluated before each iteration's
chosen agent runs. Return `undefined` or an unknown id to halt
the swarm (the loop's `until` guard fires).

#### Parameters

##### input

###### message

`string`

#### Returns

`string` \| `undefined`
