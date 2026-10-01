---
title: swarm
---

# Function: swarm()

> **swarm**(`opts`): [`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>

Defined in: [src/patterns/Swarm.ts:62](https://github.com/footprintjs/agentfootprint/blob/main/src/patterns/Swarm.ts#L62)

Build a Swarm Runner. Each iteration:
  1. Router evaluates `route(input)` to pick an agent id.
  2. Conditional dispatches to that agent's runner.
  3. Agent's output becomes the next iteration's input.
Loop halts when `route` returns a halt-sentinel id (or unknown id
falling to the `done` branch) OR when `maxHandoffs` is reached.

## Parameters

### opts

[`SwarmOptions`](/docs/api/interfaces/SwarmOptions)

## Returns

[`Runner`](/docs/api/interfaces/Runner)\<\{ `message`: `string`; \}, `string`\>
