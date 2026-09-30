---
title: SwarmAgent
---

# Interface: SwarmAgent

Defined in: src/patterns/Swarm.ts:26

## Extended by

- [`LlmSwarmAgent`](/docs/api/interfaces/LlmSwarmAgent)

## Properties

### id

> `readonly` **id**: `string`

Defined in: src/patterns/Swarm.ts:28

Stable id used in events + routing decisions.

***

### name?

> `readonly` `optional` **name?**: `string`

Defined in: src/patterns/Swarm.ts:30

Display name for topology / narrative.

***

### runner

> `readonly` **runner**: [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>

Defined in: src/patterns/Swarm.ts:32

The runner that handles a turn when selected.
