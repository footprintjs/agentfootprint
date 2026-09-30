---
title: LlmSwarmAgent
---

# Interface: LlmSwarmAgent

Defined in: [src/patterns/LlmSwarm.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L62)

A swarm member as the LLM router sees it: the runner that handles a
turn, plus the `description` that becomes its line in the router's
prompt. One source — the roster the swarm dispatches on and the roster
the model reads are the same list.

## Extends

- [`SwarmAgent`](/docs/api/interfaces/SwarmAgent)

## Properties

### description

> `readonly` **description**: `string`

Defined in: [src/patterns/LlmSwarm.ts:65](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/LlmSwarm.ts#L65)

What this agent handles, in the model's language. Required here:
 an agent with no description is invisible to the router.

***

### id

> `readonly` **id**: `string`

Defined in: [src/patterns/Swarm.ts:28](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/Swarm.ts#L28)

Stable id used in events + routing decisions.

#### Inherited from

[`SwarmAgent`](/docs/api/interfaces/SwarmAgent).[`id`](/docs/api/interfaces/SwarmAgent#id)

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: [src/patterns/Swarm.ts:30](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/Swarm.ts#L30)

Display name for topology / narrative.

#### Inherited from

[`SwarmAgent`](/docs/api/interfaces/SwarmAgent).[`name`](/docs/api/interfaces/SwarmAgent#name)

***

### runner

> `readonly` **runner**: [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/Swarm.ts:32](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/Swarm.ts#L32)

The runner that handles a turn when selected.

#### Inherited from

[`SwarmAgent`](/docs/api/interfaces/SwarmAgent).[`runner`](/docs/api/interfaces/SwarmAgent#runner)
